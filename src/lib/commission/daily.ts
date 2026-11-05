/**
 * Daily earnings & commission aggregation.
 *
 * All numbers are derived from authoritative database records
 * (DriverEarning / CommissionLedgerEntry / CommissionSettlement) — never from
 * frontend state or hardcoded values. Sums are integer kobo.
 *
 * Daily boundaries come from the configured business timezone, so rides
 * completed around midnight are counted exactly once.
 */

import { prisma } from '@/lib/prisma';
import { getCommissionConfig } from './config';
import {
  addBusinessDays,
  businessDayKey,
  businessDayRange,
  dayKeyToIso,
  isoToDayKey,
} from './time';

/** Sum helper that tolerates empty aggregates. */
function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

export type DriverDaySummary = {
  driverId: string;
  dayIso: string;
  eligibleRideCount: number;
  eligibleGrossKobo: number;
  commissionRateBps: number;
  commissionKobo: number;
  netKobo: number;
  paidRideCount: number;
  unpaidRideCount: number;
};

/**
 * One driver's summary for a single business day.
 * `commissionRateBps` is the rate snapshotted on the earnings (historical
 * rates are honored — changing the rate never rewrites past days).
 */
export async function getDriverDaySummary(
  driverId: string,
  dayKey?: Date
): Promise<DriverDaySummary> {
  const config = await getCommissionConfig();
  const key = dayKey ?? businessDayKey(new Date(), config.businessTimezone);

  const earnings = await prisma.driverEarning.findMany({
    where: { driverId, earningDate: key, status: 'ACCRUED' },
    select: {
      eligibleAmountKobo: true,
      commissionAmountKobo: true,
      netAmountKobo: true,
      commissionRateBps: true,
      payoutStatus: true,
    },
  });

  const reversals = await prisma.commissionLedgerEntry.findMany({
    where: {
      driverId,
      periodDate: key,
      entryType: { in: ['REVERSAL', 'ADJUSTMENT'] },
    },
    select: { amountKobo: true },
  });

  const commissionKoboTotal =
    sum(earnings.map((e) => e.commissionAmountKobo)) + sum(reversals.map((r) => r.amountKobo));
  const rateBps = earnings[0]?.commissionRateBps ?? config.commissionRateBps;

  return {
    driverId,
    dayIso: dayKeyToIso(key),
    eligibleRideCount: earnings.length,
    eligibleGrossKobo: sum(earnings.map((e) => e.eligibleAmountKobo)),
    commissionRateBps: rateBps,
    commissionKobo: commissionKoboTotal,
    netKobo: sum(earnings.map((e) => e.netAmountKobo)),
    paidRideCount: earnings.filter((e) => e.payoutStatus === 'PAID').length,
    unpaidRideCount: earnings.filter((e) => e.payoutStatus === 'UNPAID').length,
  };
}

export type DriverEarningRow = {
  earningId: string;
  tripId: string;
  paymentReference: string | null;
  dayIso: string;
  eligibleAmountKobo: number;
  commissionRateBps: number;
  commissionAmountKobo: number;
  netAmountKobo: number;
  payoutStatus: string;
  pickupName?: string;
  dropoffName?: string;
  rideType?: string;
};

/** Chronological per-ride breakdown for a driver (optionally day-filtered). */
export async function getDriverEarningRows(
  driverId: string,
  opts?: { dayIso?: string }
): Promise<DriverEarningRow[]> {
  const earnings = await prisma.driverEarning.findMany({
    where: {
      driverId,
      ...(opts?.dayIso ? { earningDate: isoToDayKey(opts.dayIso) } : {}),
    },
    include: {
      trip: {
        include: { pickupLocation: true, dropoffLocation: true },
      },
    },
    orderBy: { earningDate: 'desc' },
    take: 500,
  });

  return earnings.map((e) => ({
    earningId: e.id,
    tripId: e.tripId,
    paymentReference: e.paymentReference,
    dayIso: dayKeyToIso(e.earningDate),
    eligibleAmountKobo: e.eligibleAmountKobo,
    commissionRateBps: e.commissionRateBps,
    commissionAmountKobo: e.commissionAmountKobo,
    netAmountKobo: e.netAmountKobo,
    payoutStatus: e.payoutStatus,
    pickupName: e.trip?.pickupLocation?.name,
    dropoffName: e.trip?.dropoffLocation?.name,
    rideType: e.trip?.rideType,
  }));
}

export type SchoolDaySummary = {
  dayIso: string;
  eligibleRideCount: number;
  driverCount: number;
  totalEligibleGrossKobo: number;
  commissionAccruedKobo: number;
  commissionNetOfReversalsKobo: number;
  outstandingKobo: number;
  reservedKobo: number;
  settledKobo: number;
  pendingSettlementCount: number;
  failedSettlementCount: number;
};

/** School-wide summary for a single business day. */
export async function getSchoolDaySummary(dayKey?: Date): Promise<SchoolDaySummary> {
  const config = await getCommissionConfig();
  const key = dayKey ?? businessDayKey(new Date(), config.businessTimezone);

  const earnings = await prisma.driverEarning.findMany({
    where: { earningDate: key, status: 'ACCRUED' },
    select: {
      driverId: true,
      eligibleAmountKobo: true,
      commissionAmountKobo: true,
    },
  });

  const reversals = await prisma.commissionLedgerEntry.findMany({
    where: {
      periodDate: key,
      entryType: { in: ['REVERSAL', 'ADJUSTMENT'] },
    },
    select: { amountKobo: true },
  });

  const accrualAgg = await prisma.commissionLedgerEntry.aggregate({
    where: { periodDate: key, entryType: 'ACCRUAL' },
    _sum: { amountKobo: true },
  });

  const statuses = await prisma.commissionLedgerEntry.groupBy({
    by: ['status'],
    where: { periodDate: key },
    _sum: { amountKobo: true },
  });
  const statusSum = (status: string) =>
    statuses.find((s) => s.status === status)?._sum.amountKobo ?? 0;

  const settlements = await prisma.commissionSettlement.findMany({
    where: { periodDate: key },
    select: { transferStatus: true },
  });

  const accrued = accrualAgg._sum.amountKobo ?? 0;
  const reversalsSum = sum(reversals.map((r) => r.amountKobo));

  return {
    dayIso: dayKeyToIso(key),
    eligibleRideCount: earnings.length,
    driverCount: new Set(earnings.map((e) => e.driverId)).size,
    totalEligibleGrossKobo: sum(earnings.map((e) => e.eligibleAmountKobo)),
    commissionAccruedKobo: accrued,
    commissionNetOfReversalsKobo: accrued + reversalsSum,
    // statusSum covers every entry type, so adjustments are included once.
    outstandingKobo: statusSum('OUTSTANDING'),
    reservedKobo: statusSum('RESERVED'),
    settledKobo: statusSum('SETTLED'),
    pendingSettlementCount: settlements.filter(
      (s) => s.transferStatus === 'PREPARED' || s.transferStatus === 'TRANSFERRING' || s.transferStatus === 'BLOCKED'
    ).length,
    failedSettlementCount: settlements.filter((s) => s.transferStatus === 'FAILED').length,
  };
}

export type SchoolGlobalSummary = {
  totalAccruedKobo: number;
  totalOutstandingKobo: number;
  totalReservedKobo: number;
  totalSettledKobo: number;
  totalEligibleGrossKobo: number;
  eligibleRideCount: number;
  activeDriverCount: number;
  settlementCounts: Record<string, number>;
};

/** All-time school totals + settlement status counts (admin dashboard). */
export async function getSchoolGlobalSummary(): Promise<SchoolGlobalSummary> {
  const earningsAgg = await prisma.driverEarning.aggregate({
    where: { status: 'ACCRUED' },
    _sum: { eligibleAmountKobo: true, commissionAmountKobo: true },
    _count: { id: true },
  });

  const statusGroups = await prisma.commissionLedgerEntry.groupBy({
    by: ['status'],
    _sum: { amountKobo: true },
  });
  const statusSum = (status: string) =>
    statusGroups.find((s) => s.status === status)?._sum.amountKobo ?? 0;

  const accrualAgg = await prisma.commissionLedgerEntry.aggregate({
    where: { entryType: 'ACCRUAL' },
    _sum: { amountKobo: true },
  });

  const reversalAgg = await prisma.commissionLedgerEntry.aggregate({
    where: { entryType: { in: ['REVERSAL', 'ADJUSTMENT'] } },
    _sum: { amountKobo: true },
  });

  const settlementGroups = await prisma.commissionSettlement.groupBy({
    by: ['transferStatus'],
    _count: { id: true },
  });

  const driverCount = await prisma.driverEarning.findMany({
    distinct: ['driverId'],
    select: { driverId: true },
  });

  const reversals = reversalAgg._sum.amountKobo ?? 0;
  const accruals = accrualAgg._sum.amountKobo ?? 0;

  return {
    totalAccruedKobo: accruals + reversals,
    totalOutstandingKobo: statusSum('OUTSTANDING'),
    totalReservedKobo: statusSum('RESERVED'),
    totalSettledKobo: statusSum('SETTLED'),
    totalEligibleGrossKobo: earningsAgg._sum.eligibleAmountKobo ?? 0,
    eligibleRideCount: earningsAgg._count.id ?? 0,
    activeDriverCount: driverCount.length,
    settlementCounts: Object.fromEntries(
      settlementGroups.map((g) => [g.transferStatus, g._count.id])
    ),
  };
}

export type CommissionDayBucket = {
  dayIso: string;
  eligibleRideCount: number;
  grossKobo: number;
  commissionKobo: number;
};

/** Commission by day for a date range (default: last 30 completed business days). */
export async function getCommissionByDay(opts?: { fromIso?: string; toIso?: string }): Promise<
  CommissionDayBucket[]
> {
  const config = await getCommissionConfig();
  const todayKey = businessDayKey(new Date(), config.businessTimezone);
  // Include today so the history chart matches today's accrual shown above it.
  const toKey = opts?.toIso ? isoToDayKey(opts.toIso) : todayKey;
  const fromKey = opts?.fromIso
    ? isoToDayKey(opts.fromIso)
    : addBusinessDays(toKey, -29);

  if (fromKey.getTime() > toKey.getTime()) return [];

  const { end } = businessDayRange(toKey, config.businessTimezone);
  const rows = await prisma.driverEarning.findMany({
    where: { earningDate: { gte: fromKey, lt: end } },
    select: { earningDate: true, eligibleAmountKobo: true, commissionAmountKobo: true },
  });

  const reversals = await prisma.commissionLedgerEntry.findMany({
    where: {
      periodDate: { gte: fromKey, lt: end },
      entryType: { in: ['REVERSAL', 'ADJUSTMENT'] },
    },
    select: { periodDate: true, amountKobo: true },
  });

  const buckets = new Map<string, CommissionDayBucket>();
  const bucketFor = (key: Date): CommissionDayBucket => {
    const iso = dayKeyToIso(key);
    let bucket = buckets.get(iso);
    if (!bucket) {
      bucket = { dayIso: iso, eligibleRideCount: 0, grossKobo: 0, commissionKobo: 0 };
      buckets.set(iso, bucket);
    }
    return bucket;
  };

  for (const row of rows) {
    const bucket = bucketFor(row.earningDate);
    bucket.eligibleRideCount += 1;
    bucket.grossKobo += row.eligibleAmountKobo;
    bucket.commissionKobo += row.commissionAmountKobo;
  }
  for (const row of reversals) {
    bucketFor(row.periodDate).commissionKobo += row.amountKobo;
  }

  return [...buckets.values()].sort((a, b) => a.dayIso.localeCompare(b.dayIso));
}

export type CommissionByDriverRow = {
  driverId: string;
  driverName: string;
  driverCode: string;
  eligibleRideCount: number;
  grossKobo: number;
  commissionKobo: number;
};

/** Commission by driver for a business day (admin view). */
export async function getCommissionByDriver(dayIso?: string): Promise<CommissionByDriverRow[]> {
  const config = await getCommissionConfig();
  const key = dayIso ? isoToDayKey(dayIso) : businessDayKey(new Date(), config.businessTimezone);

  const earnings = await prisma.driverEarning.findMany({
    where: { earningDate: key, status: 'ACCRUED' },
    select: {
      driverId: true,
      eligibleAmountKobo: true,
      commissionAmountKobo: true,
      driver: { select: { driverId: true, user: { select: { name: true } } } },
    },
  });

  const reversals = await prisma.commissionLedgerEntry.findMany({
    where: {
      periodDate: key,
      entryType: { in: ['REVERSAL', 'ADJUSTMENT'] },
    },
    select: { driverId: true, amountKobo: true },
  });

  const byDriver = new Map<string, CommissionByDriverRow>();
  for (const row of earnings) {
    let entry = byDriver.get(row.driverId);
    if (!entry) {
      entry = {
        driverId: row.driverId,
        driverName: row.driver.user?.name ?? 'Unknown driver',
        driverCode: row.driver.driverId,
        eligibleRideCount: 0,
        grossKobo: 0,
        commissionKobo: 0,
      };
      byDriver.set(row.driverId, entry);
    }
    entry.eligibleRideCount += 1;
    entry.grossKobo += row.eligibleAmountKobo;
    entry.commissionKobo += row.commissionAmountKobo;
  }
  for (const rev of reversals) {
    const entry = byDriver.get(rev.driverId);
    if (entry) entry.commissionKobo += rev.amountKobo;
  }

  return [...byDriver.values()].sort((a, b) => b.commissionKobo - a.commissionKobo);
}
