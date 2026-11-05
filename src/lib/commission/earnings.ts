/**
 * Driver earnings accrual — the single place where eligible earnings and the
 * school's commission are recorded.
 *
 * Eligibility (server-side only, never client-supplied):
 *   1. The ride is COMPLETED (the app requires a verified successful payment
 *      before a driver can complete a ride).
 *   2. A SUCCESSFUL Payment row exists for the ride.
 *   3. An assigned driver exists.
 *   4. The ride has no earning record yet (enforced by a UNIQUE constraint on
 *      driver_earnings.trip_id, so concurrent requests can never double-accrue).
 *
 * Calculation base (see docs in the report):
 *   eligible driver earnings = the verified payment's ride fare
 *   (Trip.driverEarnings, which payment verification sets to Payment.rideFare).
 *   The ₦10 platform fee is NOT part of the driver's earnings and is excluded.
 *
 * Commission rate and computed amounts are snapshotted onto the earning and
 * ledger rows at accrual time, so later rate changes never rewrite history.
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { getCommissionConfig } from './config';
import { commissionKobo, netKobo, toKobo } from './money';
import { businessDayKey } from './time';

export type AccrualResult =
  | { status: 'accrued'; earningId: string; tripId: string }
  | { status: 'already_recorded'; earningId?: string; tripId: string }
  | { status: 'skipped'; reason: string; tripId: string };

function prismaErrorCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e
    ? String((e as { code?: unknown }).code)
    : undefined;
}

/** When the ride reached COMPLETED, from status history (fallback: trip.updatedAt). */
async function resolveCompletedAt(tripId: string, fallback: Date): Promise<Date> {
  const history = await prisma.rideStatusHistory.findFirst({
    where: { tripId, to: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
  });
  return history?.createdAt ?? fallback;
}

/**
 * Record the eligible earning + commission accrual for one trip.
 * Idempotent: safe to call any number of times, from any code path.
 */
export async function accrueEarningForTrip(tripId: string): Promise<AccrualResult> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      payments: { where: { status: 'SUCCESSFUL' }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  if (!trip) return { status: 'skipped', reason: 'trip_not_found', tripId };
  if (trip.status !== 'COMPLETED') return { status: 'skipped', reason: 'trip_not_completed', tripId };
  if (!trip.driverId) return { status: 'skipped', reason: 'trip_has_no_driver', tripId };

  const payment = trip.payments[0];
  if (!payment) return { status: 'skipped', reason: 'no_successful_payment', tripId };

  // Source of truth: the verified payment's ride fare. Trip.driverEarnings is
  // kept in sync by payment verification; fall back to it for legacy rows.
  const eligibleNaira =
    typeof trip.driverEarnings === 'number' && trip.driverEarnings > 0
      ? trip.driverEarnings
      : payment.rideFare;
  const eligibleAmountKobo = toKobo(eligibleNaira);

  if (eligibleAmountKobo <= 0) {
    return { status: 'skipped', reason: 'zero_eligible_amount', tripId };
  }

  const config = await getCommissionConfig();
  const completedAt = await resolveCompletedAt(tripId, trip.updatedAt);
  const earningDate = businessDayKey(completedAt, config.businessTimezone);

  const commissionAmount = commissionKobo(eligibleAmountKobo, config.commissionRateBps);
  const netAmount = netKobo(eligibleAmountKobo, config.commissionRateBps);

  try {
    const earning = await prisma.$transaction(async (tx) => {
      const created = await tx.driverEarning.create({
        data: {
          driverId: trip.driverId!,
          tripId: trip.id,
          paymentId: payment.id,
          paymentReference: payment.reference,
          currency: payment.currency,
          eligibleAmountKobo,
          commissionRateBps: config.commissionRateBps,
          commissionAmountKobo: commissionAmount,
          netAmountKobo: netAmount,
          earningDate,
          businessTimezone: config.businessTimezone,
        },
      });

      await tx.commissionLedgerEntry.create({
        data: {
          driverId: trip.driverId!,
          earningId: created.id,
          amountKobo: commissionAmount,
          commissionRateBps: config.commissionRateBps,
          periodDate: earningDate,
          entryType: 'ACCRUAL',
          status: 'OUTSTANDING',
          note: `Accrual for trip ${trip.id}`,
        },
      });

      return created;
    });

    logAudit({
      userId: undefined,
      action: 'commission.accrued',
      entity: 'DriverEarning',
      entityId: earning.id,
      details: {
        tripId,
        driverId: trip.driverId,
        paymentReference: payment.reference,
        eligibleAmountKobo,
        commissionRateBps: config.commissionRateBps,
        commissionAmountKobo: commissionAmount,
        netAmountKobo: netAmount,
        earningDate: earningDate.toISOString(),
      },
    }).catch(() => {});

    return { status: 'accrued', earningId: earning.id, tripId };
  } catch (e) {
    // UNIQUE(driver_earnings.trip_id) — another request already accrued it.
    if (prismaErrorCode(e) === 'P2002') {
      const existing = await prisma.driverEarning.findUnique({ where: { tripId } });
      return { status: 'already_recorded', earningId: existing?.id, tripId };
    }
    throw e;
  }
}

export type BackfillResult = {
  scanned: number;
  accrued: number;
  skipped: number;
  errors: string[];
};

/**
 * Safety net: accrue earnings for any COMPLETED + paid trip that has no
 * earning record yet (e.g. rides completed before this feature existed, or
 * if an accrual call failed transiently). Idempotent and bounded.
 */
export async function backfillEarnings(limit = 500): Promise<BackfillResult> {
  const candidates = await prisma.trip.findMany({
    where: {
      status: 'COMPLETED',
      driverId: { not: null },
      earning: { is: null },
      payments: { some: { status: 'SUCCESSFUL' } },
    },
    select: { id: true },
    take: limit,
    orderBy: { updatedAt: 'asc' },
  });

  const result: BackfillResult = { scanned: candidates.length, accrued: 0, skipped: 0, errors: [] };

  for (const trip of candidates) {
    try {
      const outcome = await accrueEarningForTrip(trip.id);
      if (outcome.status === 'accrued') result.accrued += 1;
      else result.skipped += 1;
    } catch (e) {
      result.errors.push(`${trip.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (result.accrued > 0) {
    logAudit({
      action: 'commission.backfilled',
      entity: 'DriverEarning',
      details: { scanned: result.scanned, accrued: result.accrued, errors: result.errors.length },
    }).catch(() => {});
  }

  return result;
}

export type ReversalResult =
  | { success: true; earningId: string; settled: boolean }
  | { error: string };

/**
 * Reverse/refund an accrual (e.g. refunded or reversed payment).
 *
 * Append-only: original accrual rows are never deleted. Before settlement a
 * REVERSAL entry nullifies the outstanding commission. After settlement an
 * ADJUSTMENT entry records the debt against future settlements instead of
 * pretending the completed transfer was undone.
 */
export async function reverseEarningForTrip(
  tripId: string,
  reason: string,
  actorUserId?: string
): Promise<ReversalResult> {
  const earning = await prisma.driverEarning.findUnique({
    where: { tripId },
    include: { ledgerEntries: true },
  });

  if (!earning) return { error: 'No earning record exists for this trip.' };
  if (earning.status === 'REVERSED') {
    return { success: true, earningId: earning.id, settled: false };
  }

  const accrual = earning.ledgerEntries.find((e) => e.entryType === 'ACCRUAL');
  if (!accrual) return { error: 'Ledger inconsistency: accrual entry missing.' };
  if (accrual.status === 'RESERVED') {
    return { error: 'Commission is reserved by a pending settlement. Cancel the settlement first.' };
  }

  const alreadySettled = earning.ledgerEntries.some(
    (e) => e.entryType === 'ACCRUAL' && e.status === 'SETTLED'
  );
  const alreadyReversed = earning.ledgerEntries.some(
    (e) => e.entryType === 'REVERSAL' || e.entryType === 'ADJUSTMENT'
  );
  if (alreadyReversed) {
    return { success: true, earningId: earning.id, settled: alreadySettled };
  }

  const reversalAmount = -earning.commissionAmountKobo;

  await prisma.$transaction(async (tx) => {
    await tx.commissionLedgerEntry.create({
      data: {
        driverId: earning.driverId,
        earningId: earning.id,
        amountKobo: reversalAmount,
        commissionRateBps: earning.commissionRateBps,
        periodDate: earning.earningDate,
        entryType: alreadySettled ? 'ADJUSTMENT' : 'REVERSAL',
        // Settled commission gets an ADJUSTMENT that stays OUTSTANDING so the
        // next settlement sweeps it; unsettled accruals are simply REVERSED.
        status: alreadySettled ? 'OUTSTANDING' : 'REVERSED',
        reversalOfId: accrual.id,
        note: reason,
      },
    });

    if (!alreadySettled) {
      // The accrual no longer contributes to the outstanding balance.
      await tx.commissionLedgerEntry.update({
        where: { id: accrual.id },
        data: { status: 'REVERSED' },
      });
    }

    await tx.driverEarning.update({
      where: { id: earning.id },
      data: { status: 'REVERSED' },
    });
  });

  logAudit({
    userId: actorUserId,
    action: 'commission.reversed',
    entity: 'DriverEarning',
    entityId: earning.id,
    details: {
      tripId,
      reason,
      reversalAmountKobo: reversalAmount,
      settledCommission: alreadySettled,
    },
  }).catch(() => {});

  return { success: true, earningId: earning.id, settled: alreadySettled };
}
