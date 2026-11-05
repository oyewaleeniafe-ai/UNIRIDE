'use server';

/**
 * School commission server actions (admin) + driver-facing reads.
 *
 * Every action enforces authorization server-side:
 *  - Commission configuration, settlements and reversals: ADMIN only.
 *  - Driver earnings: the signed-in driver, their own records only.
 *
 * Financial mutations are audited (see logAudit calls in the commission lib).
 */

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { getSessionUser, isAdmin, isDriver } from '@/lib/commission/authz';
import {
  commissionConfigSchema,
  getCommissionConfig,
  updateCommissionConfig,
  type CommissionConfigInput,
} from '@/lib/commission/config';
import {
  backfillEarnings,
  cancelSettlement,
  initiateSettlementTransfer,
  prepareSettlement,
  reverseEarningForTrip,
  runSettlementCycle,
  verifySettlement,
} from '@/lib/commission';
import {
  getDriverDaySummary,
  getDriverEarningRows,
} from '@/lib/commission/daily';
import { isoToDayKey, businessDayKey } from '@/lib/commission/time';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { headers } from 'next/headers';

async function getRateLimitId(): Promise<string> {
  const h = await headers();
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    h.get('cf-connecting-ip') ||
    'unknown'
  );
}

type ActionResult<T = Record<string, unknown>> = (T & { success: true }) | { error: string };

// ─── Configuration (ADMIN only) ────────────────────────

export async function getCommissionSettings(): Promise<
  { success: true; settings: Record<string, unknown> } | { error: string }
> {
  const user = await getSessionUser();
  if (!isAdmin(user)) return { error: 'Only school administrators can view commission settings.' };

  const config = await getCommissionConfig();
  return {
    success: true,
    settings: {
      commissionRateBps: config.commissionRateBps,
      businessTimezone: config.businessTimezone,
      settlementHourLocal: config.settlementHourLocal,
      autoSettlementEnabled: config.autoSettlementEnabled,
      manualApprovalRequired: config.manualApprovalRequired,
      minSettlementKobo: config.minSettlementKobo,
      recipientBankCode: config.recipientBankCode,
      recipientBankName: config.recipientBankName,
      recipientAccountNumber: config.recipientAccountNumber,
      recipientAccountName: config.recipientAccountName,
      updatedAt: config.updatedAt,
    },
  };
}

export async function saveCommissionSettings(
  input: CommissionConfigInput
): Promise<ActionResult<{ settings: Record<string, unknown> }>> {
  const user = await getSessionUser();
  if (!isAdmin(user)) return { error: 'Only school administrators can change commission settings.' };

  const parsed = commissionConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid settings' };
  }

  const result = await updateCommissionConfig(parsed.data, user!.id);
  if ('error' in result) return { error: result.error };

  revalidatePath('/admin/commission');
  return {
    success: true,
    settings: {
      commissionRateBps: result.config.commissionRateBps,
      businessTimezone: result.config.businessTimezone,
      settlementHourLocal: result.config.settlementHourLocal,
      autoSettlementEnabled: result.config.autoSettlementEnabled,
      manualApprovalRequired: result.config.manualApprovalRequired,
      minSettlementKobo: result.config.minSettlementKobo,
      recipientBankCode: result.config.recipientBankCode,
      recipientBankName: result.config.recipientBankName,
      recipientAccountNumber: result.config.recipientAccountNumber,
      recipientAccountName: result.config.recipientAccountName,
      updatedAt: result.config.updatedAt,
    },
  };
}

// ─── Settlements (ADMIN only) ──────────────────────────

/**
 * Prepare (reserve) a settlement for a business day WITHOUT initiating any
 * transfer. Repeated calls are idempotent per day.
 */
export async function prepareCommissionSettlement(dayIso?: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!isAdmin(user)) return { error: 'Only school administrators can prepare settlements.' };

  const rateLimitId = await getRateLimitId();
  const limit = checkRateLimit(rateLimitId, RATE_LIMITS.payment);
  if (!limit.allowed) return { error: 'Too many requests. Please try again later.' };

  const config = await getCommissionConfig();
  const targetKey = dayIso ? isoToDayKey(dayIso) : businessDayKey(new Date(), config.businessTimezone);
  const prepared = await prepareSettlement(targetKey);

  revalidatePath('/admin/commission');

  switch (prepared.status) {
    case 'prepared':
    case 'already_prepared':
      return {
        success: true,
        settlementId: prepared.settlementId,
        reference: prepared.reference,
        totalKobo: prepared.totalKobo,
        entryCount: prepared.entryCount,
        ...(prepared.status === 'already_prepared' ? { transferStatus: prepared.transferStatus } : {}),
      };
    case 'nothing_outstanding':
      return { error: `No outstanding commission for ${prepared.dayIso}.` };
    case 'below_minimum':
      return {
        error: `Outstanding ₦${(prepared.totalKobo / 100).toFixed(2)} is below the minimum settlement of ₦${(prepared.minKobo / 100).toFixed(2)}.`,
      };
    case 'invalid_period':
      return { error: prepared.reason };
    default:
      return { error: 'Unable to prepare settlement.' };
  }
}

/** Initiate the Flutterwave transfer for a prepared settlement, then verify. */
export async function initiateCommissionTransfer(settlementId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!isAdmin(user)) return { error: 'Only school administrators can initiate transfers.' };

  const rateLimitId = await getRateLimitId();
  const limit = checkRateLimit(rateLimitId, RATE_LIMITS.payment);
  if (!limit.allowed) return { error: 'Too many requests. Please try again later.' };

  const initiated = await initiateSettlementTransfer(settlementId, { actorUserId: user!.id });
  if ('error' in initiated) return { error: initiated.error };

  // Best-effort immediate confirmation; a processing result stays pending and
  // is reconciled later — it is never reported as transferred.
  const verify = await verifySettlement(settlementId);
  revalidatePath('/admin/commission');

  if ('error' in verify) return { error: verify.error };
  switch (verify.status) {
    case 'confirmed':
      return { success: true, transfer: 'confirmed', reference: verify.reference };
    case 'failed':
      return { success: true, transfer: 'failed', reference: verify.reference, reason: verify.reason };
    case 'pending':
      return { success: true, transfer: 'pending', reference: verify.reference };
    default:
      return { success: true, transfer: 'pending', note: verify.reason };
  }
}

/** Re-check a transfer's authoritative status with Flutterwave. */
export async function verifyCommissionSettlement(settlementId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!isAdmin(user)) return { error: 'Only school administrators can verify settlements.' };

  const outcome = await verifySettlement(settlementId);
  revalidatePath('/admin/commission');

  if ('error' in outcome) return { error: outcome.error };
  switch (outcome.status) {
    case 'confirmed':
      return { success: true, status: 'confirmed', reference: outcome.reference };
    case 'failed':
      return { success: true, status: 'failed', reference: outcome.reference, reason: outcome.reason };
    case 'pending':
      return { success: true, status: 'pending', reference: outcome.reference };
    default:
      return { success: true, status: 'unchanged', note: outcome.reason };
  }
}

export async function cancelCommissionSettlement(
  settlementId: string,
  reason: string
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!isAdmin(user)) return { error: 'Only school administrators can cancel settlements.' };

  const outcome = await cancelSettlement(settlementId, reason, user!.id);
  revalidatePath('/admin/commission');
  if ('error' in outcome) return { error: outcome.error };
  return { success: true };
}

/** Full settlement cycle (backfill + reconcile + prepare + initiate if allowed). */
export async function runCommissionSettlementCycle(dayIso?: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!isAdmin(user)) return { error: 'Only school administrators can run settlement cycles.' };

  const rateLimitId = await getRateLimitId();
  const limit = checkRateLimit(rateLimitId, RATE_LIMITS.payment);
  if (!limit.allowed) return { error: 'Too many requests. Please try again later.' };

  const cycle = await runSettlementCycle({ dayIso, actorUserId: user!.id, trigger: 'manual' });
  revalidatePath('/admin/commission');
  return {
    success: true,
    dayIso: cycle.dayIso,
    settlementId: cycle.settlementId ?? null,
    reference: cycle.reference ?? null,
    totalKobo: cycle.totalKobo ?? null,
    transferInitiated: cycle.transferInitiated,
    transferConfirmed: cycle.transferConfirmed ?? false,
    reason: cycle.reason ?? null,
    errors: cycle.errors,
    backfill: cycle.backfill ?? null,
    reconcile: cycle.reconcile ?? null,
  };
}

/**
 * Record a commission reversal/adjustment for a trip (refund path).
 * Append-only — never edits committed ledger rows.
 */
export async function reverseTripCommission(
  tripId: string,
  reason: string
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!isAdmin(user)) return { error: 'Only school administrators can reverse commission.' };

  if (!reason || reason.trim().length < 3) {
    return { error: 'A reason is required for commission reversals.' };
  }

  const outcome = await reverseEarningForTrip(tripId, reason.trim(), user!.id);
  revalidatePath('/admin/commission');
  if ('error' in outcome) return { error: outcome.error };
  return { success: true, earningId: outcome.earningId, settledCommission: outcome.settled };
}

// ─── Driver reads ──────────────────────────────────────

/** The signed-in driver's earnings for one business day (default: today). */
export async function getMyCommissionDay(dayIso?: string): Promise<
  { success: true; summary: Awaited<ReturnType<typeof getDriverDaySummary>> } | { error: string }
> {
  const user = await getSessionUser();
  if (!isDriver(user)) return { error: 'Only drivers can view earnings.' };

  const driver = await prisma.driver.findUnique({ where: { userId: user!.id } });
  if (!driver) return { error: 'Driver profile not found.' };

  const config = await getCommissionConfig();
  const key = dayIso ? isoToDayKey(dayIso) : businessDayKey(new Date(), config.businessTimezone);
  const summary = await getDriverDaySummary(driver.id, key);
  return { success: true, summary };
}

/** The signed-in driver's per-ride earning rows (own records only). */
export async function getMyEarningRows(dayIso?: string): Promise<
  { success: true; rows: Awaited<ReturnType<typeof getDriverEarningRows>> } | { error: string }
> {
  const user = await getSessionUser();
  if (!isDriver(user)) return { error: 'Only drivers can view earnings.' };

  const driver = await prisma.driver.findUnique({ where: { userId: user!.id } });
  if (!driver) return { error: 'Driver profile not found.' };

  const rows = await getDriverEarningRows(driver.id, dayIso ? { dayIso } : undefined);
  return { success: true, rows };
}

/** Force a backfill of missed accruals (admin safety tool). */
export async function runEarningsBackfill(): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!isAdmin(user)) return { error: 'Only school administrators can run backfills.' };

  const result = await backfillEarnings();

  await logAudit({
    userId: user!.id,
    action: 'commission.backfilled',
    entity: 'DriverEarning',
    details: { scanned: result.scanned, accrued: result.accrued, errors: result.errors.length },
  });

  revalidatePath('/admin/commission');
  return {
    success: true,
    scanned: result.scanned,
    accrued: result.accrued,
    errors: result.errors,
  };
}
