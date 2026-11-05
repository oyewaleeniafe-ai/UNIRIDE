/**
 * Daily commission settlement engine.
 *
 * Strategy: **daily accumulation + one transfer per settlement run**
 * (Option B in the design). CampusCab receives the full student payment into
 * its own Flutterwave account and already pays drivers out separately, so the
 * school's commission is accumulated in the ledger during the business day
 * and transferred to the school's verified account afterwards. No split
 * payments are used and the existing payment flow is untouched.
 *
 * Safety invariants:
 *  - Every settlement has a stable idempotency key (`commission-run-<day>`),
 *    so a repeated job run or concurrent request can never reserve or pay the
 *    same commission twice (UNIQUE constraint is the enforcement point).
 *  - Ledger entries only move OUTSTANDING → RESERVED → SETTLED (or released
 *    back to OUTSTANDING on definitive failure). Nothing is ever deleted.
 *  - A transfer marked "processing" is NEVER settled — settlement requires a
 *    separate fetchTransfer() confirmation of status AND amount AND currency.
 *  - No new transfer is initiated while a previous one is unresolved.
 *  - Automatic transfers are disabled by default
 *    (CommissionConfig.autoSettlementEnabled = false).
 */

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { logAudit } from '@/lib/audit';
import { maskAccountNumber } from '@/lib/payments/types';
import { createSchoolTransfer, fetchTransfer } from '@/lib/payments/flutterwave';
import { getCommissionConfig, hasSchoolRecipient } from './config';
import { backfillEarnings } from './earnings';
import {
  dayKeyToIso,
  isoToDayKey,
  previousBusinessDayKey,
  settlementTargetDayKey,
} from './time';

type Tx = Prisma.TransactionClient;

function prismaErrorCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e
    ? String((e as { code?: unknown }).code)
    : undefined;
}

function transfersEnvEnabled(): boolean {
  return Boolean(process.env.FLUTTERWAVE_TRANSFERS_ENABLED);
}

export function settlementRunKey(dayIso: string): string {
  return `commission-run-${dayIso}`;
}

export type PrepareResult =
  | { status: 'prepared'; settlementId: string; reference: string; totalKobo: number; entryCount: number }
  | { status: 'already_prepared'; settlementId: string; reference: string; totalKobo: number; entryCount: number; transferStatus: string }
  | { status: 'nothing_outstanding'; dayIso: string }
  | { status: 'below_minimum'; dayIso: string; totalKobo: number; minKobo: number }
  | { status: 'invalid_period'; reason: string };

/**
 * Reserve every OUTSTANDING commission entry (period ≤ target day) into one
 * idempotent settlement record for the target business day.
 */
export async function prepareSettlement(targetKey: Date): Promise<PrepareResult> {
  const config = await getCommissionConfig();
  // Latest permissible target = today's business day in the configured tz.
  const latestAllowedKey = previousBusinessDayKey(
    new Date(Date.now() + 86_400_000),
    config.businessTimezone
  );

  if (targetKey.getTime() > latestAllowedKey.getTime()) {
    return { status: 'invalid_period', reason: 'Cannot settle a future business day.' };
  }

  const dayIso = dayKeyToIso(targetKey);

  // Idempotency: one settlement per business day. If the day's settlement
  // FAILED or was CANCELLED (entries already released), a retry gets a fresh
  // suffixed key so the released entries can be swept again — while an active
  // (PREPARED/TRANSFERRING) or confirmed (SUCCESSFUL) settlement keeps
  // blocking duplicates.
  const terminalStatuses = ['FAILED', 'CANCELLED', 'BLOCKED'];
  let attempts = 0;
  const keyForAttempt = (n: number) =>
    n === 0 ? settlementRunKey(dayIso) : `${settlementRunKey(dayIso)}-retry-${n}`;

  let existing = await prisma.commissionSettlement.findUnique({
    where: { idempotencyKey: keyForAttempt(0) },
  });
  while (existing && terminalStatuses.includes(existing.transferStatus) && attempts < 20) {
    attempts += 1;
    existing = await prisma.commissionSettlement.findUnique({
      where: { idempotencyKey: keyForAttempt(attempts) },
    });
  }

  const idempotencyKey = keyForAttempt(attempts);
  if (existing) {
    return {
      status: 'already_prepared',
      settlementId: existing.id,
      reference: existing.reference,
      totalKobo: existing.totalAmountKobo,
      entryCount: existing.entryCount,
      transferStatus: existing.transferStatus,
    };
  }

  const entries = await prisma.commissionLedgerEntry.findMany({
    where: { status: 'OUTSTANDING', periodDate: { lte: targetKey } },
    select: { id: true, amountKobo: true },
  });

  const totalKobo = entries.reduce((acc, e) => acc + e.amountKobo, 0);

  if (entries.length === 0 || totalKobo <= 0) {
    // Zero/negative outstanding: nothing to transfer. A negative-only balance
    // (recovering adjustments) is left for the next accrual to offset.
    return { status: 'nothing_outstanding', dayIso };
  }

  if (totalKobo < config.minSettlementKobo) {
    return { status: 'below_minimum', dayIso, totalKobo, minKobo: config.minSettlementKobo };
  }

  const entryIds = entries.map((e) => e.id);
  const reference = `ccab-comm-${dayIso}-${Date.now().toString(36)}`;

  try {
    const settlement = await prisma.$transaction(async (tx) => {
      const created = await tx.commissionSettlement.create({
        data: {
          reference,
          periodDate: targetKey,
          totalAmountKobo: totalKobo,
          entryCount: entryIds.length,
          recipientBankCode: config.recipientBankCode,
          recipientAccountNumber: config.recipientAccountNumber,
          recipientLabel: config.recipientBankCode
            ? `${config.recipientBankName ?? 'School account'} ${maskAccountNumber(
                config.recipientAccountNumber ?? undefined
              )}`
            : null,
          idempotencyKey,
        },
      });

      // Atomically reserve exactly the entries we counted. If a concurrent
      // run reserved any of them first, count mismatch aborts the transaction.
      const reserved = await tx.commissionLedgerEntry.updateMany({
        where: { id: { in: entryIds }, status: 'OUTSTANDING', settlementId: null },
        data: { status: 'RESERVED', settlementId: created.id },
      });
      if (reserved.count !== entryIds.length) {
        throw new Error('CONCURRENT_RESERVATION');
      }

      return created;
    });

    logAudit({
      action: 'commission.settlement_prepared',
      entity: 'CommissionSettlement',
      entityId: settlement.id,
      details: {
        reference,
        dayIso,
        totalKobo,
        entryCount: entryIds.length,
      },
    }).catch(() => {});

    return {
      status: 'prepared',
      settlementId: settlement.id,
      reference,
      totalKobo,
      entryCount: entryIds.length,
    };
  } catch (e) {
    if (prismaErrorCode(e) === 'P2002' || e instanceof Error) {
      // Lost a race (or the reservation count mismatched): adopt the winner.
      const winner = await prisma.commissionSettlement.findUnique({
        where: { idempotencyKey },
      });
      if (winner) {
        return {
          status: 'already_prepared',
          settlementId: winner.id,
          reference: winner.reference,
          totalKobo: winner.totalAmountKobo,
          entryCount: winner.entryCount,
          transferStatus: winner.transferStatus,
        };
      }
    }
    throw e;
  }
}

/** Move a settlement's entries back to OUTSTANDING (release the reservation). */
async function releaseEntries(tx: Tx, settlementId: string): Promise<void> {
  await tx.commissionLedgerEntry.updateMany({
    where: { settlementId, status: 'RESERVED' },
    data: { status: 'OUTSTANDING', settlementId: null },
  });
}

export type InitiateResult =
  | { success: true; settlementId: string; providerReference?: string; transferStatus: string }
  | { error: string; settlementId?: string };

/**
 * Initiate the Flutterwave transfer for a PREPARED settlement.
 *
 * `actorUserId` set  → explicit manual/admin initiation.
 * `actorUserId` null → scheduled job (only when auto settlement is enabled).
 */
export async function initiateSettlementTransfer(
  settlementId: string,
  opts?: { actorUserId?: string }
): Promise<InitiateResult> {
  const config = await getCommissionConfig();
  const auto = !opts?.actorUserId;

  if (auto && !config.autoSettlementEnabled) {
    return { error: 'Automatic settlement is disabled in commission settings.', settlementId };
  }

  const settlement = await prisma.commissionSettlement.findUnique({
    where: { id: settlementId },
  });
  if (!settlement) return { error: 'Settlement not found.' };
  if (settlement.transferStatus !== 'PREPARED') {
    return {
      error: `Settlement is ${settlement.transferStatus}; only PREPARED settlements can be initiated.`,
      settlementId,
    };
  }

  if (!hasSchoolRecipient(config)) {
    return {
      error: 'School recipient account is not configured (bank code + account number required).',
      settlementId,
    };
  }

  if (!transfersEnvEnabled()) {
    return {
      error:
        'Flutterwave transfers are not enabled. Set FLUTTERWAVE_TRANSFERS_ENABLED=1 only after the merchant account is approved for transfers.',
      settlementId,
    };
  }

  // Never issue a new transfer while a previous one is unresolved.
  const unresolved = await prisma.commissionSettlement.findFirst({
    where: { transferStatus: 'TRANSFERRING' },
    select: { id: true, reference: true },
  });
  if (unresolved && unresolved.id !== settlementId) {
    return {
      error: `Transfer ${unresolved.reference} is still unresolved; verify it before starting another.`,
      settlementId,
    };
  }

  const result = await createSchoolTransfer({
    amountKobo: settlement.totalAmountKobo,
    reference: settlement.reference,
    recipient: {
      bankCode: config.recipientBankCode!,
      accountNumber: config.recipientAccountNumber!,
      accountName: config.recipientAccountName ?? undefined,
    },
    narration: `CampusCab school commission ${dayKeyToIso(settlement.periodDate)}`,
  });

  if (result.error) {
    // Definitive initiation failure: keep the obligation, release the
    // reservation so a later attempt can sweep the entries again.
    await prisma.$transaction(async (tx) => {
      await tx.commissionSettlement.update({
        where: { id: settlementId },
        data: {
          transferStatus: 'FAILED',
          failureReason: result.error,
          failedAt: new Date(),
          reconciliationStatus: 'RECONCILED',
        },
      });
      await releaseEntries(tx, settlementId);
    });

    logAudit({
      userId: opts?.actorUserId,
      action: 'commission.transfer_failed',
      entity: 'CommissionSettlement',
      entityId: settlementId,
      details: { reference: settlement.reference, reason: result.error },
    }).catch(() => {});

    return { error: result.error, settlementId };
  }

  await prisma.commissionSettlement.update({
    where: { id: settlementId },
    data: {
      transferStatus: 'TRANSFERRING',
      providerReference: result.providerReference ?? settlement.reference,
      initiatedAt: new Date(),
      failureReason: null,
      reconciliationStatus: 'UNRECONCILED',
    },
  });

  logAudit({
    userId: opts?.actorUserId,
    action: 'commission.transfer_initiated',
    entity: 'CommissionSettlement',
    entityId: settlementId,
    details: {
      reference: settlement.reference,
      providerReference: result.providerReference,
      totalKobo: settlement.totalAmountKobo,
      initiatedBy: opts?.actorUserId ?? 'scheduled-job',
    },
  }).catch(() => {});

  return {
    success: true,
    settlementId,
    providerReference: result.providerReference,
    transferStatus: 'TRANSFERRING',
  };
}

export type VerifyResult =
  | { status: 'confirmed'; settlementId: string; reference: string }
  | { status: 'failed'; settlementId: string; reference: string; reason: string }
  | { status: 'pending'; settlementId: string; reference: string }
  | { status: 'unchanged'; settlementId: string; reason: string }
  | { error: string };

/**
 * Confirm the outcome of a TRANSFERRING settlement directly with Flutterwave.
 * Success requires status = successful AND amount AND currency to match the
 * settlement — only then do ledger entries become SETTLED.
 */
export async function verifySettlement(settlementId: string): Promise<VerifyResult> {
  const settlement = await prisma.commissionSettlement.findUnique({
    where: { id: settlementId },
  });

  if (!settlement) return { error: 'Settlement not found.' };
  if (settlement.transferStatus !== 'TRANSFERRING') {
    return { status: 'unchanged', settlementId, reason: `status is ${settlement.transferStatus}` };
  }
  if (!settlement.providerReference) {
    return { status: 'unchanged', settlementId, reason: 'no provider reference recorded' };
  }

  const result = await fetchTransfer(settlement.providerReference);

  if (result.error) {
    // Unknown outcome (network/config) — never guess. Leave state untouched.
    return { status: 'unchanged', settlementId, reason: result.error };
  }

  if (result.status === 'successful') {
    const expectedNaira = settlement.totalAmountKobo / 100;
    const amountOk =
      result.amount == null || Math.abs(result.amount - expectedNaira) <= 0.01;
    const currencyOk = !result.currency || result.currency === 'NGN';

    if (!amountOk || !currencyOk) {
      await prisma.commissionSettlement.update({
        where: { id: settlementId },
        data: {
          reconciliationStatus: 'NEEDS_REVIEW',
          failureReason: !currencyOk
            ? `Currency mismatch: expected NGN, got ${result.currency}`
            : `Amount mismatch: expected ${expectedNaira} NGN, got ${result.amount}`,
        },
      });
      return {
        status: 'unchanged',
        settlementId,
        reason: 'verification mismatch — marked NEEDS_REVIEW',
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.commissionSettlement.update({
        where: { id: settlementId },
        data: {
          transferStatus: 'SUCCESSFUL',
          confirmedAt: new Date(),
          reconciliationStatus: 'RECONCILED',
          failureReason: null,
        },
      });
      await tx.commissionLedgerEntry.updateMany({
        where: { settlementId, status: 'RESERVED' },
        data: { status: 'SETTLED' },
      });
    });

    logAudit({
      action: 'commission.transfer_confirmed',
      entity: 'CommissionSettlement',
      entityId: settlementId,
      details: {
        reference: settlement.reference,
        providerReference: settlement.providerReference,
        totalKobo: settlement.totalAmountKobo,
      },
    }).catch(() => {});

    return { status: 'confirmed', settlementId, reference: settlement.reference };
  }

  if (result.status === 'failed') {
    const reason = result.failureReason ?? 'Flutterwave reported the transfer as failed';

    await prisma.$transaction(async (tx) => {
      await tx.commissionSettlement.update({
        where: { id: settlementId },
        data: {
          transferStatus: 'FAILED',
          failedAt: new Date(),
          reconciliationStatus: 'RECONCILED',
          failureReason: reason,
        },
      });
      await releaseEntries(tx, settlementId);
    });

    logAudit({
      action: 'commission.transfer_failed',
      entity: 'CommissionSettlement',
      entityId: settlementId,
      details: { reference: settlement.reference, reason },
    }).catch(() => {});

    return { status: 'failed', settlementId, reference: settlement.reference, reason };
  }

  return { status: 'pending', settlementId, reference: settlement.reference };
}

/**
 * Reconcile every unresolved (TRANSFERRING) settlement. Safe to call from
 * cron, webhooks and admin actions. Never initiates anything.
 */
export async function reconcileTransfers(): Promise<{
  checked: number;
  confirmed: number;
  failed: number;
  pending: number;
  errors: string[];
}> {
  const pendingRows = await prisma.commissionSettlement.findMany({
    where: { transferStatus: 'TRANSFERRING' },
    select: { id: true },
  });

  const summary = { checked: 0, confirmed: 0, failed: 0, pending: 0, errors: [] as string[] };

  for (const row of pendingRows) {
    summary.checked += 1;
    try {
      const outcome = await verifySettlement(row.id);
      if ('error' in outcome) {
        summary.errors.push(outcome.error);
      } else if (outcome.status === 'confirmed') {
        summary.confirmed += 1;
      } else if (outcome.status === 'failed') {
        summary.failed += 1;
      } else if (outcome.status === 'pending') {
        summary.pending += 1;
      } else {
        summary.errors.push(outcome.reason);
      }
    } catch (e) {
      summary.errors.push(`${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return summary;
}

export type CancelResult = { success: true; settlementId: string } | { error: string };

/** Cancel a PREPARED (never initiated) settlement and release its entries. */
export async function cancelSettlement(
  settlementId: string,
  reason: string,
  actorUserId?: string
): Promise<CancelResult> {
  const settlement = await prisma.commissionSettlement.findUnique({
    where: { id: settlementId },
  });
  if (!settlement) return { error: 'Settlement not found.' };
  if (settlement.transferStatus !== 'PREPARED') {
    return {
      error: `Only PREPARED settlements can be cancelled (this one is ${settlement.transferStatus}).`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.commissionSettlement.update({
      where: { id: settlementId },
      data: { transferStatus: 'CANCELLED', failureReason: reason },
    });
    await releaseEntries(tx, settlementId);
  });

  logAudit({
    userId: actorUserId,
    action: 'commission.settlement_cancelled',
    entity: 'CommissionSettlement',
    entityId: settlementId,
    details: { reference: settlement.reference, reason },
  }).catch(() => {});

  return { success: true, settlementId };
}

export type CycleResult = {
  ran: boolean;
  trigger: 'cron' | 'manual';
  dayIso: string;
  /** Backfill safety net results. */
  backfill?: { scanned: number; accrued: number; errors: number };
  reconcile?: { checked: number; confirmed: number; failed: number; pending: number };
  settlementId?: string;
  reference?: string;
  totalKobo?: number;
  transferInitiated: boolean;
  transferConfirmed?: boolean;
  reason?: string;
  errors: string[];
};

/**
 * One full settlement cycle:
 *   1. Backfill any missed accruals (idempotent safety net).
 *   2. Reconcile unresolved transfers BEFORE anything new.
 *   3. Prepare (reserve) the target day's settlement — idempotent.
 *   4. Initiate a transfer only when explicitly allowed; confirm it separately.
 *
 * Repeated executions are always safe: step 2 and the idempotency key do the
 * work, and step 3/4 refuse to double-reserve or double-pay.
 */
export async function runSettlementCycle(opts?: {
  dayIso?: string;
  actorUserId?: string;
  trigger?: 'cron' | 'manual';
}): Promise<CycleResult> {
  const config = await getCommissionConfig();
  const trigger: 'cron' | 'manual' = opts?.actorUserId ? 'manual' : 'cron';
  // Scheduled runs settle the last completed business day, shifted back one
  // more day when the configured release hour has not been reached yet. Manual
  // runs are never clock-gated.
  const targetKey = opts?.dayIso
    ? isoToDayKey(opts.dayIso)
    : trigger === 'cron'
      ? settlementTargetDayKey(new Date(), config.businessTimezone, config.settlementHourLocal)
      : settlementTargetDayKey(new Date(), config.businessTimezone, 0);
  const dayIso = dayKeyToIso(targetKey);

  const result: CycleResult = {
    ran: true,
    trigger,
    dayIso,
    transferInitiated: false,
    errors: [],
  };

  // 1. Safety net: accrue anything missed.
  try {
    const backfill = await backfillEarnings();
    result.backfill = { scanned: backfill.scanned, accrued: backfill.accrued, errors: backfill.errors.length };
    if (backfill.errors.length > 0) result.errors.push(...backfill.errors);
  } catch (e) {
    result.errors.push(`backfill: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Reconcile unresolved transfers first — never stack new ones on top.
  try {
    const reconcile = await reconcileTransfers();
    result.reconcile = {
      checked: reconcile.checked,
      confirmed: reconcile.confirmed,
      failed: reconcile.failed,
      pending: reconcile.pending,
    };
    result.errors.push(...reconcile.errors);
  } catch (e) {
    result.errors.push(`reconcile: ${e instanceof Error ? e.message : String(e)}`);
  }

  const stillUnresolved = await prisma.commissionSettlement.count({
    where: { transferStatus: 'TRANSFERRING' },
  });
  if (stillUnresolved > 0) {
    return {
      ...result,
      transferInitiated: false,
      reason: 'A previous transfer is still unresolved; no new transfer initiated.',
    };
  }

  // 3. Prepare/reserve (idempotent per business day).
  const prepared = await prepareSettlement(targetKey);
  if (prepared.status === 'nothing_outstanding') {
    return { ...result, reason: 'No outstanding commission for this period.' };
  }
  if (prepared.status === 'below_minimum') {
    return {
      ...result,
      totalKobo: prepared.totalKobo,
      reason: `Outstanding ₦${(prepared.totalKobo / 100).toFixed(2)} is below the minimum settlement threshold of ₦${(prepared.minKobo / 100).toFixed(2)}.`,
    };
  }
  if (prepared.status === 'invalid_period') {
    return { ...result, reason: prepared.reason };
  }

  result.settlementId = prepared.settlementId;
  result.reference = prepared.reference;
  result.totalKobo = prepared.totalKobo;

  const cronAuto =
    trigger === 'cron' && config.autoSettlementEnabled && !config.manualApprovalRequired;
  const manualInitiated = trigger === 'manual' && Boolean(opts?.actorUserId);
  const canTransfer = cronAuto || manualInitiated;

  if (prepared.status === 'already_prepared' && prepared.transferStatus !== 'PREPARED') {
    // Already handled (or in flight) — report its current state.
    return {
      ...result,
      reason: `Settlement already exists with status ${prepared.transferStatus}.`,
    };
  }

  if (!canTransfer) {
    if (trigger === 'cron' && config.autoSettlementEnabled && config.manualApprovalRequired) {
      return {
        ...result,
        reason:
          'Settlement prepared. Manual approval is required — an administrator must initiate the transfer.',
      };
    }
    return {
      ...result,
      reason: config.autoSettlementEnabled
        ? 'Settlement prepared; transfers require manual initiation.'
        : 'Settlement prepared. Automatic transfers are disabled — an administrator must initiate the transfer.',
    };
  }

  if (!hasSchoolRecipient(config)) {
    return {
      ...result,
      reason: 'Settlement prepared but blocked: school recipient account is not configured.',
    };
  }

  if (!transfersEnvEnabled()) {
    return {
      ...result,
      reason:
        'Settlement prepared but blocked: Flutterwave transfers are not enabled (FLUTTERWAVE_TRANSFERS_ENABLED).',
    };
  }

  // 4. Initiate.
  const initiated = await initiateSettlementTransfer(prepared.settlementId, {
    actorUserId: opts?.actorUserId,
  });
  if ('error' in initiated) {
    return { ...result, errors: [...result.errors, initiated.error], reason: initiated.error };
  }
  result.transferInitiated = true;

  // Best-effort immediate confirmation; a "processing" result stays pending
  // and is picked up by the next reconciliation pass.
  try {
    const verify = await verifySettlement(prepared.settlementId);
    if ('error' in verify) {
      result.errors.push(`verify: ${verify.error}`);
    } else if (verify.status === 'confirmed') {
      result.transferConfirmed = true;
    } else if (verify.status === 'failed') {
      result.errors.push(`transfer failed: ${verify.reason}`);
    }
  } catch (e) {
    result.errors.push(`verify: ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}
