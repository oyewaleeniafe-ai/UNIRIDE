import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { prisma, cleanDatabase, createTestStudent, createTestDriver, getTestLocation } from './setup';
import { accrueEarningForTrip, backfillEarnings, reverseEarningForTrip } from '@/lib/commission/earnings';
import { commissionKobo, netKobo, toKobo, fromKobo, formatKobo, rateBpsToPercent } from '@/lib/commission/money';
import {
  businessDayKey,
  businessDayRange,
  dayKeyToIso,
  isoToDayKey,
  previousBusinessDayKey,
  settlementTargetDayKey,
} from '@/lib/commission/time';
import {
  prepareSettlement,
  initiateSettlementTransfer,
  verifySettlement,
  runSettlementCycle,
  cancelSettlement,
  settlementRunKey,
} from '@/lib/commission/settlements';
import {
  getDriverDaySummary,
  getSchoolDaySummary,
  getSchoolGlobalSummary,
  getCommissionByDay,
  getCommissionByDriver,
} from '@/lib/commission/daily';
import { updateCommissionConfig } from '@/lib/commission/config';
import { createPayoutForTrip } from '@/lib/payments';
import { GET as driverGET } from '@/app/api/commission/driver/route';
import { GET as summaryGET } from '@/app/api/commission/summary/route';
import { PATCH as configPATCH } from '@/app/api/commission/config/route';
import { GET as runGET, POST as runPOST } from '@/app/api/commission/settlements/run/route';
import { GET as settlementsGET } from '@/app/api/commission/settlements/route';

/**
 * School commission system tests.
 *
 * - All Flutterwave HTTP calls are mocked via global fetch — no merchant
 *   credentials, internet access or real transfers.
 * - `@/lib/prisma` is redirected to the SQLite test client, `@/lib/auth` is a
 *   controllable fake session, `next/headers` returns a unique IP per call.
 * - Route handlers are invoked directly with absolute request URLs.
 * - No test ever initiates a real transfer.
 */

// ── hoisted environment (before any module import) ─────────────────────────

vi.hoisted(() => {
  process.env.FLUTTERWAVE_SECRET_KEY = 'FLWSECK_TEST_SECRET';
  process.env.FLUTTERWAVE_WEBHOOK_SECRET = 'test-webhook-secret';
  process.env.CRON_SECRET = 'test-cron-secret';
  process.env.FLUTTERWAVE_TRANSFERS_ENABLED = '1';
});

const sessionState = vi.hoisted(() => ({
  user: null as { id: string; email: string; role: string } | null,
}));

const rateLimitIp = vi.hoisted(() => ({ n: 0 }));

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () => (sessionState.user ? { user: { ...sessionState.user } } : null)),
  getUserId: vi.fn(async () => {
    if (!sessionState.user) throw new Error('Not authenticated');
    return sessionState.user.id;
  }),
  getUserRole: vi.fn(async () => {
    if (!sessionState.user) throw new Error('Not authenticated');
    return sessionState.user.role;
  }),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-forwarded-for': `test-ip-${++rateLimitIp.n}` })),
}));

vi.mock('@/lib/prisma', async () => {
  const setup = await import('./setup');
  return { prisma: setup.prisma };
});

// ── helpers ─────────────────────────────────────────────────────────────────

const realFetch = globalThis.fetch;
let fetchHandler: ((url: string, init?: RequestInit) => Response | undefined) | null = null;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

function setFetchHandler(handler: typeof fetchHandler) {
  fetchHandler = handler;
}

function signInAs(user: { id: string; email: string; role: string }) {
  sessionState.user = user;
}

function signOut() {
  sessionState.user = null;
}

function apiReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

async function setConfig(patch: Record<string, unknown>) {
  const defaults = {
    id: 1,
    commissionRateBps: 500,
    businessTimezone: 'Africa/Lagos',
    settlementHourLocal: 0,
    autoSettlementEnabled: false,
    manualApprovalRequired: true,
    minSettlementKobo: 0,
    recipientBankCode: null,
    recipientBankName: null,
    recipientAccountNumber: null,
    recipientAccountName: null,
  };
  await prisma.commissionConfig.upsert({
    where: { id: 1 },
    update: patch,
    create: { ...defaults, ...patch },
  });
}

async function resetConfig() {
  await setConfig({
    commissionRateBps: 500,
    businessTimezone: 'Africa/Lagos',
    settlementHourLocal: 0,
    autoSettlementEnabled: false,
    manualApprovalRequired: true,
    minSettlementKobo: 0,
    recipientBankCode: null,
    recipientBankName: null,
    recipientAccountNumber: null,
    recipientAccountName: null,
  });
}

async function makeAdmin() {
  const user = await createTestStudent({ email: `admin-${Date.now()}-${Math.random()}@test.com` });
  await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
  return { ...user, role: 'ADMIN' };
}

/** Noon on the last completed business day (the settlement cycle's target). */
function yesterdayNoon(): Date {
  const key = previousBusinessDayKey(new Date(), 'Africa/Lagos');
  return new Date(key.getTime() + 11 * 3600 * 1000);
}

type TripOpts = {
  fare?: number;
  platform?: number;
  paymentStatus?: 'SUCCESSFUL' | 'PENDING' | 'FAILED';
  tripStatus?: 'COMPLETED' | 'PENDING' | 'CANCELLED';
  completedAt?: Date;
  withDriver?: boolean;
};

/**
 * A completed, paid (or configurable) trip — the eligibility fixture.
 */
async function makeTrip(driverUserId: string, opts: TripOpts = {}) {
  const fare = opts.fare ?? 800;
  const platform = opts.platform ?? 10;
  const student = await createTestStudent();
  const pickup = await getTestLocation('Commission Pickup');
  const dropoff = await getTestLocation('Commission Dropoff');

  const driver = await prisma.driver.findUnique({ where: { userId: driverUserId } });
  if (!driver) throw new Error('driver fixture missing');

  const trip = await prisma.trip.create({
    data: {
      studentId: student.student.id,
      driverId: opts.withDriver === false ? null : driver.id,
      pickupLocationId: pickup.id,
      dropoffLocationId: dropoff.id,
      rideType: 'SOLO_QUICK_CAB',
      passengerCount: 1,
      totalFare: fare + platform,
      appCharge: platform,
      driverEarnings: fare,
      status: opts.tripStatus ?? 'COMPLETED',
    },
  });

  const payment = await prisma.payment.create({
    data: {
      userId: student.id,
      tripId: trip.id,
      reference: `ccab-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      passengerCount: 1,
      rideFare: fare,
      platformFee: platform,
      totalAmount: fare + platform,
      currency: 'NGN',
      status: opts.paymentStatus ?? 'SUCCESSFUL',
      paidAt: (opts.paymentStatus ?? 'SUCCESSFUL') === 'SUCCESSFUL' ? new Date() : null,
    },
  });

  if ((opts.tripStatus ?? 'COMPLETED') === 'COMPLETED') {
    await prisma.rideStatusHistory.create({
      data: {
        tripId: trip.id,
        userId: student.id,
        from: 'IN_PROGRESS',
        to: 'COMPLETED',
        ...(opts.completedAt ? { createdAt: opts.completedAt } : {}),
      },
    });
  }

  return { trip, payment, student, driver };
}

async function makeDriver() {
  const user = await createTestDriver();
  const driver = await prisma.driver.findUnique({ where: { userId: user.id } });
  if (!driver) throw new Error('driver fixture missing');
  return { user, driver };
}

// ── suite ───────────────────────────────────────────────────────────────────

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const response = fetchHandler?.(url, init);
    if (response) return response;
    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  fetchHandler = null;
});

afterEach(() => {
  fetchHandler = null;
  signOut();
});

describe('money math (integer kobo)', () => {
  it('converts NGN to kobo exactly', () => {
    expect(toKobo(800)).toBe(80000);
    expect(toKobo(0.1)).toBe(10);
    expect(fromKobo(4000)).toBe(40);
    expect(formatKobo(4000)).toBe('₦40.00');
    expect(formatKobo(1234567)).toBe('₦12,345.67');
    expect(rateBpsToPercent(500)).toBe('5%');
    expect(rateBpsToPercent(125)).toBe('1.25%');
  });

  it('computes 5% commission with half-up kobo rounding', () => {
    // ₦800 → ₦40; ₦200 → ₦10
    expect(commissionKobo(80000, 500)).toBe(4000);
    expect(commissionKobo(20000, 500)).toBe(1000);
    // half-up: 5% of 333 kobo = 16.65 → 17
    expect(commissionKobo(333, 500)).toBe(17);
    // exact remainder stays exact
    expect(commissionKobo(10000, 1500)).toBe(1500);
    expect(netKobo(80000, 500)).toBe(76000);
    expect(netKobo(20000, 500)).toBe(19000);
  });

  it('rejects invalid inputs', () => {
    expect(() => commissionKobo(80000.5, 500)).toThrow();
    expect(() => commissionKobo(80000, 10001)).toThrow();
    expect(() => commissionKobo(80000, -1)).toThrow();
    expect(() => toKobo(Number.NaN)).toThrow();
  });
});

describe('business-day boundaries (timezone)', () => {
  it('assigns instants to the correct Lagos business day', () => {
    // Lagos = UTC+1, no DST.
    expect(dayKeyToIso(businessDayKey(new Date('2026-10-21T22:30:00Z'), 'Africa/Lagos'))).toBe(
      '2026-10-21'
    );
    // 23:30Z is already 00:30 next day in Lagos.
    expect(dayKeyToIso(businessDayKey(new Date('2026-10-21T23:30:00Z'), 'Africa/Lagos'))).toBe(
      '2026-10-22'
    );
    expect(dayKeyToIso(businessDayKey(new Date('2026-10-21T11:00:00Z'), 'Africa/Lagos'))).toBe(
      '2026-10-21'
    );
  });

  it('produces exact, non-overlapping day ranges', () => {
    const key = isoToDayKey('2026-10-21');
    const day1 = businessDayRange(key, 'Africa/Lagos');
    const day2 = businessDayRange(new Date(key.getTime() + 86_400_000), 'Africa/Lagos');
    expect(day1.start.toISOString()).toBe('2026-10-20T23:00:00.000Z');
    expect(day1.end.toISOString()).toBe(day2.start.toISOString());
    // A ride at 23:30Z belongs to the next day exactly once.
    const instant = new Date('2026-10-21T23:30:00Z');
    expect(instant >= day1.start && instant < day1.end).toBe(false);
    expect(instant >= day2.start && instant < day2.end).toBe(true);
  });

  it('computes the previous business day', () => {
    expect(
      dayKeyToIso(previousBusinessDayKey(new Date('2026-10-21T09:00:00Z'), 'Africa/Lagos'))
    ).toBe('2026-10-20');
  });
});

describe('earning accrual (eligibility + idempotency)', () => {
  it('records earning + commission ledger for one completed paid ride', async () => {
    await cleanDatabase();
    await resetConfig();
    const { user } = await makeDriver();
    const { trip, payment } = await makeTrip(user.id);

    const outcome = await accrueEarningForTrip(trip.id);
    expect(outcome.status).toBe('accrued');

    const earning = await prisma.driverEarning.findUnique({ where: { tripId: trip.id } });
    expect(earning).toBeTruthy();
    expect(earning!.eligibleAmountKobo).toBe(80000); // platform fee excluded
    expect(earning!.commissionRateBps).toBe(500);
    expect(earning!.commissionAmountKobo).toBe(4000);
    expect(earning!.netAmountKobo).toBe(76000);
    expect(earning!.currency).toBe('NGN');
    expect(earning!.paymentReference).toBe(payment.reference);
    expect(earning!.payoutStatus).toBe('UNPAID');
    expect(earning!.status).toBe('ACCRUED');
    expect(earning!.businessTimezone).toBe('Africa/Lagos');
    expect(earning!.earningDate).toBeInstanceOf(Date);

    const entries = await prisma.commissionLedgerEntry.findMany({
      where: { earningId: earning!.id },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].entryType).toBe('ACCRUAL');
    expect(entries[0].status).toBe('OUTSTANDING');
    expect(entries[0].amountKobo).toBe(4000);
    expect(entries[0].commissionRateBps).toBe(500);
    expect(entries[0].periodDate.getTime()).toBe(earning!.earningDate.getTime());
  });

  it('never accrues twice for the same ride (duplicate completion)', async () => {
    await cleanDatabase();
    await resetConfig();
    const { user } = await makeDriver();
    const { trip } = await makeTrip(user.id);

    const first = await accrueEarningForTrip(trip.id);
    const second = await accrueEarningForTrip(trip.id);
    expect(first.status).toBe('accrued');
    expect(second.status).toBe('already_recorded');

    expect(await prisma.driverEarning.count({ where: { tripId: trip.id } })).toBe(1);
    expect(
      await prisma.commissionLedgerEntry.count({ where: { earning: { tripId: trip.id } } })
    ).toBe(1);
  });

  it('survives concurrent accrual requests with a single record', async () => {
    await cleanDatabase();
    await resetConfig();
    const { user } = await makeDriver();
    const { trip } = await makeTrip(user.id);

    const results = await Promise.all([accrueEarningForTrip(trip.id), accrueEarningForTrip(trip.id)]);
    const accrued = results.filter((r) => r.status === 'accrued');
    expect(accrued.length).toBeGreaterThanOrEqual(1);
    expect(await prisma.driverEarning.count({ where: { tripId: trip.id } })).toBe(1);
  });

  it('skips ineligible rides (no payment, wrong status, no driver)', async () => {
    await cleanDatabase();
    await resetConfig();
    const { user } = await makeDriver();

    const unpaid = await makeTrip(user.id, { paymentStatus: 'PENDING' });
    expect((await accrueEarningForTrip(unpaid.trip.id)).status).toBe('skipped');

    const cancelled = await makeTrip(user.id, { tripStatus: 'CANCELLED' });
    expect((await accrueEarningForTrip(cancelled.trip.id)).status).toBe('skipped');

    const driverless = await makeTrip(user.id, { withDriver: false });
    expect((await accrueEarningForTrip(driverless.trip.id)).status).toBe('skipped');

    expect(await prisma.driverEarning.count()).toBe(0);
  });

  it('accrues multiple rides for one driver and multiple drivers per day', async () => {
    await cleanDatabase();
    await resetConfig();
    const driverA = await makeDriver();
    const driverB = await makeDriver();

    const t1 = await makeTrip(driverA.user.id);
    const t2 = await makeTrip(driverA.user.id, { fare: 200 });
    const t3 = await makeTrip(driverB.user.id);

    await accrueEarningForTrip(t1.trip.id);
    await accrueEarningForTrip(t2.trip.id);
    await accrueEarningForTrip(t3.trip.id);

    const rowsA = await prisma.driverEarning.findMany({ where: { driverId: driverA.driver.id } });
    expect(rowsA).toHaveLength(2);
    expect(rowsA.reduce((s, r) => s + r.eligibleAmountKobo, 0)).toBe(100000);
    expect(rowsA.reduce((s, r) => s + r.commissionAmountKobo, 0)).toBe(5000);

    const rowsB = await prisma.driverEarning.findMany({ where: { driverId: driverB.driver.id } });
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0].commissionAmountKobo).toBe(4000);
  });

  it('backfills legacy completed+paid rides exactly once', async () => {
    await cleanDatabase();
    await resetConfig();
    const { user } = await makeDriver();
    await makeTrip(user.id);
    await makeTrip(user.id, { fare: 200 });

    const first = await backfillEarnings();
    expect(first.accrued).toBe(2);

    const second = await backfillEarnings();
    expect(second.accrued).toBe(0);
    expect(await prisma.driverEarning.count()).toBe(2);
  });

  it('snapshots the rate: changing the rate never rewrites history', async () => {
    await cleanDatabase();
    await resetConfig();
    const { user } = await makeDriver();

    const older = await makeTrip(user.id);
    await accrueEarningForTrip(older.trip.id);

    await setConfig({ commissionRateBps: 1000 }); // 10%
    const newer = await makeTrip(user.id);
    await accrueEarningForTrip(newer.trip.id);

    const rows = await prisma.driverEarning.findMany({
      where: { tripId: { in: [older.trip.id, newer.trip.id] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows[0].commissionRateBps).toBe(500);
    expect(rows[0].commissionAmountKobo).toBe(4000);
    expect(rows[1].commissionRateBps).toBe(1000);
    expect(rows[1].commissionAmountKobo).toBe(8000);
  });
});

describe('daily aggregation', () => {
  it('aggregates one driver across multiple rides for the day', async () => {
    await cleanDatabase();
    await resetConfig();
    const { user, driver } = await makeDriver();
    const t1 = await makeTrip(user.id);
    const t2 = await makeTrip(user.id, { fare: 200 });
    await accrueEarningForTrip(t1.trip.id);
    await accrueEarningForTrip(t2.trip.id);

    const todayKey = businessDayKey(new Date(), 'Africa/Lagos');
    const summary = await getDriverDaySummary(driver.id, todayKey);
    expect(summary.eligibleRideCount).toBe(2);
    expect(summary.eligibleGrossKobo).toBe(100000);
    expect(summary.commissionKobo).toBe(5000);
    expect(summary.netKobo).toBe(95000);
    expect(summary.commissionRateBps).toBe(500);
    expect(summary.unpaidRideCount).toBe(2);
    expect(summary.paidRideCount).toBe(0);
  });

  it('aggregates the school view across drivers', async () => {
    await cleanDatabase();
    await resetConfig();
    const a = await makeDriver();
    const b = await makeDriver();
    await accrueEarningForTrip((await makeTrip(a.user.id)).trip.id);
    await accrueEarningForTrip((await makeTrip(b.user.id, { fare: 200 })).trip.id);

    const todayKey = businessDayKey(new Date(), 'Africa/Lagos');
    const day = await getSchoolDaySummary(todayKey);
    expect(day.eligibleRideCount).toBe(2);
    expect(day.driverCount).toBe(2);
    expect(day.totalEligibleGrossKobo).toBe(100000);
    expect(day.commissionAccruedKobo).toBe(5000);
    expect(day.outstandingKobo).toBe(5000);

    const global = await getSchoolGlobalSummary();
    expect(global.totalAccruedKobo).toBe(5000);
    expect(global.totalOutstandingKobo).toBe(5000);
    expect(global.totalSettledKobo).toBe(0);
    expect(global.eligibleRideCount).toBe(2);
    expect(global.activeDriverCount).toBe(2);

    const todayIso = dayKeyToIso(todayKey);
    const byDriver = await getCommissionByDriver(todayIso);
    expect(byDriver).toHaveLength(2);
    expect(byDriver.every((d: { commissionKobo: number }) => d.commissionKobo > 0)).toBe(true);

    const byDay = await getCommissionByDay({ fromIso: todayIso, toIso: todayIso });
    expect(byDay).toHaveLength(1);
    expect(byDay[0].commissionKobo).toBe(5000);
    expect(byDay[0].eligibleRideCount).toBe(2);
  });

  it('counts rides completed around midnight exactly once', async () => {
    await cleanDatabase();
    await resetConfig();
    const { user } = await makeDriver();

    // 23:30 Lagos on 2026-10-21 = 22:30Z; 00:30 Lagos on 2026-10-22 = 23:30Z.
    const lateDay1 = await makeTrip(user.id, { completedAt: new Date('2026-10-21T22:30:00Z') });
    const earlyDay2 = await makeTrip(user.id, { completedAt: new Date('2026-10-21T23:30:00Z') });
    await accrueEarningForTrip(lateDay1.trip.id);
    await accrueEarningForTrip(earlyDay2.trip.id);

    const day1 = isoToDayKey('2026-10-21');
    const day2 = isoToDayKey('2026-10-22');

    expect(await prisma.driverEarning.count({ where: { earningDate: day1 } })).toBe(1);
    expect(await prisma.driverEarning.count({ where: { earningDate: day2 } })).toBe(1);
    expect(await prisma.driverEarning.count()).toBe(2); // never double-counted
  });

  it('shifts the settlement target back a day before the release hour', () => {
    const tz = 'Africa/Lagos';
    // 2026-10-22T00:30:00Z = 01:30 Lagos (local hour 1).
    const earlyMorning = new Date('2026-10-22T00:30:00Z');
    // 2026-10-22T12:00:00Z = 13:00 Lagos (local hour 13).
    const afternoon = new Date('2026-10-22T12:00:00Z');

    // Release hour 1 already reached -> settle the last completed day (10-21).
    expect(dayKeyToIso(settlementTargetDayKey(earlyMorning, tz, 1))).toBe('2026-10-21');
    // Release hour 5 not yet reached -> shift back one more day (10-20).
    expect(dayKeyToIso(settlementTargetDayKey(earlyMorning, tz, 5))).toBe('2026-10-20');
    // In the afternoon every release hour has passed.
    expect(dayKeyToIso(settlementTargetDayKey(afternoon, tz, 5))).toBe('2026-10-21');
    // Release hour 0 never shifts.
    expect(dayKeyToIso(settlementTargetDayKey(earlyMorning, tz, 0))).toBe('2026-10-21');
  });
});

describe('reversals and adjustments (append-only ledger)', () => {
  it('reverses unsettled commission without deleting the accrual', async () => {
    await cleanDatabase();
    await resetConfig();
    const { user } = await makeDriver();
    const { trip } = await makeTrip(user.id);
    await accrueEarningForTrip(trip.id);

    const result = await reverseEarningForTrip(trip.id, 'Student refunded after cancellation');
    expect(result).toHaveProperty('success', true);

    const earning = await prisma.driverEarning.findUnique({ where: { tripId: trip.id } });
    expect(earning!.status).toBe('REVERSED');

    const entries = await prisma.commissionLedgerEntry.findMany({
      where: { earningId: earning!.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries).toHaveLength(2); // accrual preserved + reversal appended
    expect(entries[0].entryType).toBe('ACCRUAL');
    expect(entries[0].status).toBe('REVERSED');
    expect(entries[1].entryType).toBe('REVERSAL');
    expect(entries[1].amountKobo).toBe(-4000);
    expect(entries[1].reversalOfId).toBe(entries[0].id);

    const global = await getSchoolGlobalSummary();
    expect(global.totalOutstandingKobo).toBe(0);
    expect(global.totalAccruedKobo).toBe(0);
  });

  it('records an adjustment (not a fake undo) after commission is settled', async () => {
    await cleanDatabase();
    await resetConfig();
    const { user } = await makeDriver();
    const { trip } = await makeTrip(user.id);
    await accrueEarningForTrip(trip.id);

    await prisma.commissionLedgerEntry.updateMany({
      where: { entryType: 'ACCRUAL' },
      data: { status: 'SETTLED' },
    });

    const result = await reverseEarningForTrip(trip.id, 'Payment reversed by provider');
    expect(result).toHaveProperty('success', true);

    const entries = await prisma.commissionLedgerEntry.findMany({
      where: { earning: { tripId: trip.id } },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries).toHaveLength(2);
    expect(entries[0].status).toBe('SETTLED'); // historical record untouched
    expect(entries[1].entryType).toBe('ADJUSTMENT');
    expect(entries[1].status).toBe('OUTSTANDING'); // recoverable from future settlements
    expect(entries[1].amountKobo).toBe(-4000);

    const global = await getSchoolGlobalSummary();
    expect(global.totalSettledKobo).toBe(4000);
    expect(global.totalOutstandingKobo).toBe(-4000);
  });
});

describe('settlement cycle (idempotent, transfers gated)', () => {
  /** Accrue a ride completed on the last business day (the cycle's target). */
  async function accrueOne(fare = 800) {
    const { user } = await makeDriver();
    const { trip } = await makeTrip(user.id, { fare, completedAt: yesterdayNoon() });
    await accrueEarningForTrip(trip.id);
    return trip;
  }

  async function configForTransfer() {
    await setConfig({
      recipientBankCode: '044',
      recipientBankName: 'Test Bank',
      recipientAccountNumber: '1234567890',
      recipientAccountName: 'Test School Account',
      settlementHourLocal: 0,
    });
  }

  it('prepares a settlement once and reserves the entries atomically', async () => {
    await cleanDatabase();
    await resetConfig();
    await accrueOne(); // ₦40 commission

    const key = previousBusinessDayKey(new Date(), 'Africa/Lagos');
    const first = await prepareSettlement(key);
    expect(first.status).toBe('prepared');
    if (first.status !== 'prepared') return;

    const second = await prepareSettlement(key);
    expect(second.status).toBe('already_prepared');
    expect(second).toHaveProperty('settlementId', first.settlementId);

    const settlements = await prisma.commissionSettlement.findMany();
    expect(settlements).toHaveLength(1);
    expect(settlements[0].totalAmountKobo).toBe(4000);
    expect(settlements[0].entryCount).toBe(1);
    expect(settlements[0].idempotencyKey).toBe(settlementRunKey(dayKeyToIso(key)));
    expect(settlements[0].transferStatus).toBe('PREPARED');

    const entries = await prisma.commissionLedgerEntry.findMany();
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('RESERVED');
    expect(entries[0].settlementId).toBe(settlements[0].id);
  });

  it('reports below-minimum and nothing-outstanding correctly', async () => {
    await cleanDatabase();
    await resetConfig();
    const key = previousBusinessDayKey(new Date(), 'Africa/Lagos');

    const empty = await prepareSettlement(key);
    expect(empty.status).toBe('nothing_outstanding');

    await accrueOne();
    await setConfig({ minSettlementKobo: 1_000_000 }); // ₦10,000 minimum
    const tooSmall = await prepareSettlement(key);
    expect(tooSmall.status).toBe('below_minimum');
  });

  it('cron cycle with automatic settlement DISABLED prepares but never transfers', async () => {
    await cleanDatabase();
    await resetConfig(); // autoSettlementEnabled: false
    await configForTransfer();
    await accrueOne();

    setFetchHandler(() => {
      throw new Error('Transfer must not be attempted while automatic settlement is disabled');
    });

    const cycle = await runSettlementCycle({ trigger: 'cron' });
    expect(cycle.ran).toBe(true);
    expect(cycle.settlementId).toBeTruthy();
    expect(cycle.transferInitiated).toBe(false);
    expect(cycle.reason).toMatch(/disabled/i);

    const settlement = await prisma.commissionSettlement.findFirstOrThrow();
    expect(settlement.transferStatus).toBe('PREPARED');
  });

  it('manual initiation is blocked without recipient/transfer permissions', async () => {
    await cleanDatabase();
    await resetConfig();
    await accrueOne();
    const key = previousBusinessDayKey(new Date(), 'Africa/Lagos');
    const prepared = await prepareSettlement(key);
    if (prepared.status !== 'prepared') throw new Error('expected prepared settlement');

    const noRecipient = await initiateSettlementTransfer(prepared.settlementId, {
      actorUserId: 'admin-1',
    });
    expect(noRecipient).toHaveProperty('error');
    expect(String((noRecipient as { error: string }).error)).toMatch(/recipient/i);

    await configForTransfer();
    const savedEnv = process.env.FLUTTERWAVE_TRANSFERS_ENABLED;
    delete process.env.FLUTTERWAVE_TRANSFERS_ENABLED;
    const noPermissions = await initiateSettlementTransfer(prepared.settlementId, {
      actorUserId: 'admin-1',
    });
    expect(noPermissions).toHaveProperty('error');
    expect(String((noPermissions as { error: string }).error)).toMatch(/not enabled/i);
    process.env.FLUTTERWAVE_TRANSFERS_ENABLED = savedEnv;
  });

  it('initiates a transfer and does NOT mark it settled without verification', async () => {
    await cleanDatabase();
    await resetConfig();
    await configForTransfer();
    await accrueOne();
    const key = previousBusinessDayKey(new Date(), 'Africa/Lagos');
    const prepared = await prepareSettlement(key);
    if (prepared.status !== 'prepared') throw new Error('expected fresh preparation');

    setFetchHandler((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(body.amount).toBe('40.00');
        expect(body.account_bank).toBe('044');
        expect(body.account_number).toBe('1234567890');
        expect(body.currency).toBe('NGN');
        return jsonResponse({
          status: 'success',
          data: { id: 777, reference: body.reference, status: 'PROCESSING' },
        });
      }
      return undefined;
    });

    const initiated = await initiateSettlementTransfer(prepared.settlementId, {
      actorUserId: 'admin-1',
    });
    expect(initiated).toHaveProperty('success', true);

    const settlement = await prisma.commissionSettlement.findFirstOrThrow();
    expect(settlement.transferStatus).toBe('TRANSFERRING');
    expect(settlement.providerReference).toBeTruthy();
    expect(settlement.initiatedAt).toBeInstanceOf(Date);

    const entries = await prisma.commissionLedgerEntry.findMany();
    expect(entries.every((e) => e.status === 'RESERVED')).toBe(true);
    const global = await getSchoolGlobalSummary();
    expect(global.totalSettledKobo).toBe(0);
  });

  it('confirms a verified transfer: SETTLED only after Flutterwave says successful', async () => {
    await cleanDatabase();
    await resetConfig();
    await configForTransfer();
    await accrueOne();
    const key = previousBusinessDayKey(new Date(), 'Africa/Lagos');
    const prepared = await prepareSettlement(key);
    if (prepared.status !== 'prepared') throw new Error('expected fresh preparation');

    setFetchHandler((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        return jsonResponse({
          status: 'success',
          data: { id: 778, reference: body.reference, status: 'PROCESSING' },
        });
      }
      if (url.includes('/transfers/fetch_by_reference')) {
        return jsonResponse({
          status: 'success',
          data: { id: 778, reference: 'x', status: 'SUCCESSFUL', amount: 40, currency: 'NGN' },
        });
      }
      return undefined;
    });

    await initiateSettlementTransfer(prepared.settlementId, { actorUserId: 'admin-1' });
    const verified = await verifySettlement(prepared.settlementId);
    expect(verified.status).toBe('confirmed');

    const settlement = await prisma.commissionSettlement.findFirstOrThrow();
    expect(settlement.transferStatus).toBe('SUCCESSFUL');
    expect(settlement.reconciliationStatus).toBe('RECONCILED');
    expect(settlement.confirmedAt).toBeInstanceOf(Date);

    const entries = await prisma.commissionLedgerEntry.findMany();
    expect(entries.every((e) => e.status === 'SETTLED')).toBe(true);

    const global = await getSchoolGlobalSummary();
    expect(global.totalSettledKobo).toBe(4000);
    expect(global.totalOutstandingKobo).toBe(0);
    expect(global.totalReservedKobo).toBe(0);
  });

  it('flags amount mismatches as NEEDS_REVIEW instead of settling', async () => {
    await cleanDatabase();
    await resetConfig();
    await configForTransfer();
    await accrueOne();
    const key = previousBusinessDayKey(new Date(), 'Africa/Lagos');
    const prepared = await prepareSettlement(key);
    if (prepared.status !== 'prepared') throw new Error('expected fresh preparation');

    setFetchHandler((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        return jsonResponse({
          status: 'success',
          data: { id: 1, reference: body.reference, status: 'NEW' },
        });
      }
      if (url.includes('/transfers/fetch_by_reference')) {
        return jsonResponse({
          status: 'success',
          data: { id: 1, reference: 'x', status: 'SUCCESSFUL', amount: 1, currency: 'NGN' },
        });
      }
      return undefined;
    });

    await initiateSettlementTransfer(prepared.settlementId, { actorUserId: 'admin-1' });
    const verified = await verifySettlement(prepared.settlementId);
    expect(verified.status).toBe('unchanged');

    const settlement = await prisma.commissionSettlement.findFirstOrThrow();
    expect(settlement.transferStatus).toBe('TRANSFERRING');
    expect(settlement.reconciliationStatus).toBe('NEEDS_REVIEW');
    const entries = await prisma.commissionLedgerEntry.findMany();
    expect(entries.every((e) => e.status === 'RESERVED')).toBe(true);
  });

  it('releases entries back to OUTSTANDING when Flutterwave reports failure', async () => {
    await cleanDatabase();
    await resetConfig();
    await configForTransfer();
    await accrueOne();
    const key = previousBusinessDayKey(new Date(), 'Africa/Lagos');
    const prepared = await prepareSettlement(key);
    if (prepared.status !== 'prepared') throw new Error('expected fresh preparation');

    setFetchHandler((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        return jsonResponse({
          status: 'success',
          data: { id: 5, reference: body.reference, status: 'FAILED' },
        });
      }
      if (url.includes('/transfers/fetch_by_reference')) {
        return jsonResponse({
          status: 'success',
          data: {
            id: 5,
            reference: 'x',
            status: 'FAILED',
            amount: 40,
            currency: 'NGN',
            fail_message: 'Beneficiary account invalid',
          },
        });
      }
      return undefined;
    });

    await initiateSettlementTransfer(prepared.settlementId, { actorUserId: 'admin-1' });
    const verified = await verifySettlement(prepared.settlementId);
    expect(verified.status).toBe('failed');

    const settlement = await prisma.commissionSettlement.findFirstOrThrow();
    expect(settlement.transferStatus).toBe('FAILED');
    expect(settlement.failureReason).toBeTruthy();

    const entries = await prisma.commissionLedgerEntry.findMany();
    expect(entries.every((e) => e.status === 'OUTSTANDING' && e.settlementId === null)).toBe(true);
    const global = await getSchoolGlobalSummary();
    expect(global.totalOutstandingKobo).toBe(4000);

    // A fresh cycle can re-prepare the released entries under a new settlement.
    const rePrepared = await prepareSettlement(key);
    expect(rePrepared.status).toBe('prepared');
  });

  it('leaves state untouched when transfer verification cannot connect', async () => {
    await cleanDatabase();
    await resetConfig();
    await configForTransfer();
    await accrueOne();
    const key = previousBusinessDayKey(new Date(), 'Africa/Lagos');
    const prepared = await prepareSettlement(key);
    if (prepared.status !== 'prepared') throw new Error('expected fresh preparation');

    setFetchHandler((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        return jsonResponse({
          status: 'success',
          data: { id: 9, reference: body.reference, status: 'NEW' },
        });
      }
      if (url.includes('/transfers/fetch_by_reference')) {
        throw new Error('network down');
      }
      return undefined;
    });

    await initiateSettlementTransfer(prepared.settlementId, { actorUserId: 'admin-1' });
    const verified = await verifySettlement(prepared.settlementId);
    expect(verified.status).toBe('unchanged');

    const settlement = await prisma.commissionSettlement.findFirstOrThrow();
    expect(settlement.transferStatus).toBe('TRANSFERRING'); // never assumed successful
    expect(settlement.reconciliationStatus).toBe('UNRECONCILED');
  });

  it('never issues a new transfer while one is unresolved', async () => {
    await cleanDatabase();
    await resetConfig();
    await configForTransfer();

    await accrueOne();
    const key1 = previousBusinessDayKey(new Date(), 'Africa/Lagos');
    const first = await prepareSettlement(key1);
    if (first.status !== 'prepared') throw new Error('expected fresh preparation');

    setFetchHandler((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        return jsonResponse({
          status: 'success',
          data: { id: 1, reference: body.reference, status: 'PROCESSING' },
        });
      }
      if (url.includes('/transfers/fetch_by_reference')) {
        // Still processing forever — "unresolved".
        return jsonResponse({
          status: 'success',
          data: { id: 1, reference: 'x', status: 'PROCESSING', amount: 40, currency: 'NGN' },
        });
      }
      return undefined;
    });
    await initiateSettlementTransfer(first.settlementId, { actorUserId: 'admin-1' });

    // Second business day with new commission: accrue dated two days ago so
    // its period is ≤ the new target day.
    const { user } = await makeDriver();
    const olderTrip = await makeTrip(user.id, {
      fare: 200,
      completedAt: new Date(key1.getTime() - 86_400_000 + 11 * 3600 * 1000),
    });
    await accrueEarningForTrip(olderTrip.trip.id);

    const key2 = new Date(key1.getTime() + 86_400_000);
    const second = await prepareSettlement(key2);
    expect(second.status).toBe('prepared');

    const blocked = await initiateSettlementTransfer(
      second.status === 'prepared' ? second.settlementId : '',
      { actorUserId: 'admin-1' }
    );
    expect(blocked).toHaveProperty('error');
    expect(String((blocked as { error: string }).error)).toMatch(/unresolved/i);

    const transferring = (await prisma.commissionSettlement.findMany()).filter(
      (s) => s.transferStatus === 'TRANSFERRING'
    );
    expect(transferring).toHaveLength(1);
  });

  it('repeated settlement cycles never double-reserve or double-pay', async () => {
    await cleanDatabase();
    await resetConfig();
    await configForTransfer();
    await accrueOne();

    setFetchHandler((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        return jsonResponse({
          status: 'success',
          data: { id: 42, reference: body.reference, status: 'PROCESSING' },
        });
      }
      if (url.includes('/transfers/fetch_by_reference')) {
        return jsonResponse({
          status: 'success',
          data: { id: 42, reference: 'x', status: 'SUCCESSFUL', amount: 40, currency: 'NGN' },
        });
      }
      return undefined;
    });

    const firstCycle = await runSettlementCycle({ actorUserId: 'admin-1', trigger: 'manual' });
    expect(firstCycle.settlementId).toBeTruthy();
    expect(firstCycle.transferInitiated).toBe(true);
    expect(firstCycle.transferConfirmed).toBe(true);

    const secondCycle = await runSettlementCycle({ actorUserId: 'admin-1', trigger: 'manual' });
    expect(secondCycle.transferInitiated).toBe(false);

    expect(await prisma.commissionSettlement.count()).toBe(1);
    const entries = await prisma.commissionLedgerEntry.findMany();
    expect(entries.every((e) => e.status === 'SETTLED')).toBe(true);
    const global = await getSchoolGlobalSummary();
    expect(global.totalSettledKobo).toBe(4000);
    expect(global.totalOutstandingKobo).toBe(0);
  });

  it('cancels a prepared settlement and releases its entries', async () => {
    await cleanDatabase();
    await resetConfig();
    await accrueOne();
    const key = previousBusinessDayKey(new Date(), 'Africa/Lagos');
    const prepared = await prepareSettlement(key);
    if (prepared.status !== 'prepared') throw new Error('expected fresh preparation');

    const cancelled = await cancelSettlement(prepared.settlementId, 'Duplicate period', 'admin-1');
    expect(cancelled).toHaveProperty('success', true);

    const settlement = await prisma.commissionSettlement.findFirstOrThrow();
    expect(settlement.transferStatus).toBe('CANCELLED');
    const entries = await prisma.commissionLedgerEntry.findMany();
    expect(entries.every((e) => e.status === 'OUTSTANDING' && e.settlementId === null)).toBe(true);
  });
});

describe('driver payout respects the commission', () => {
  it('pays the driver their NET earnings (commission withheld)', async () => {
    await cleanDatabase();
    await resetConfig();
    const { user, driver } = await makeDriver();
    const { trip, payment } = await makeTrip(user.id); // ₦800 fare
    await accrueEarningForTrip(trip.id);

    await prisma.driverPaymentAccount.create({
      data: {
        driverId: driver.id,
        provider: 'FLUTTERWAVE',
        bankCode: '044',
        bankName: 'Test Bank',
        accountNumber: '9876543210',
        accountName: 'Test Driver',
        verificationStatus: 'VERIFIED',
      },
    });

    setFetchHandler((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(body.amount).toBe('760'); // ₦800 − ₦40 commission
        return jsonResponse({
          status: 'success',
          data: { id: 3, reference: body.reference, status: 'SUCCESSFUL' },
        });
      }
      return undefined;
    });

    const result = await createPayoutForTrip({ tripId: trip.id, paymentId: payment.id });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe('SUCCESS');

    const payout = await prisma.payout.findFirstOrThrow();
    expect(payout.amount).toBe(760);

    const earning = await prisma.driverEarning.findFirstOrThrow();
    expect(earning.payoutStatus).toBe('PAID');
  });
});

describe('audit trail', () => {
  /**
   * Audit writes are deliberately fire-and-forget (they must never block a
   * ride completion or a settlement), so the test polls for the row instead of
   * assuming it is already committed.
   */
  async function waitForAudit(action: string) {
    for (let i = 0; i < 50; i++) {
      const rows = await prisma.auditLog.findMany({ where: { action } });
      if (rows.length > 0) return rows;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return prisma.auditLog.findMany({ where: { action } });
  }

  it('writes an auditable record for accrual, settlement and config changes', async () => {
    await cleanDatabase();
    await resetConfig();
    const { user } = await makeDriver();
    const { trip } = await makeTrip(user.id, { completedAt: yesterdayNoon() });

    await accrueEarningForTrip(trip.id);

    const accrualLogs = await waitForAudit('commission.accrued');
    expect(accrualLogs).toHaveLength(1);
    // The test schema stores details as a JSON string (SQLite has no Json
    // type) — it must contain the real amounts, not be dropped.
    const details = JSON.parse(String(accrualLogs[0].details));
    expect(details.commissionAmountKobo).toBe(4000);
    expect(details.eligibleAmountKobo).toBe(80000);
    expect(details.commissionRateBps).toBe(500);

    const key = previousBusinessDayKey(new Date(), 'Africa/Lagos');
    const prepared = await prepareSettlement(key);
    if (prepared.status !== 'prepared') throw new Error('expected prepared settlement');

    const settlementLogs = await waitForAudit('commission.settlement_prepared');
    expect(settlementLogs.length).toBeGreaterThanOrEqual(1);

    const admin = await makeAdmin();
    await updateCommissionConfig(
      {
        commissionRateBps: 750,
        businessTimezone: 'Africa/Lagos',
        settlementHourLocal: 1,
        autoSettlementEnabled: false,
        manualApprovalRequired: true,
        minSettlementKobo: 0,
        recipientBankCode: null,
        recipientBankName: null,
        recipientAccountNumber: null,
        recipientAccountName: null,
      },
      admin.id
    );

    const configLogs = await waitForAudit('commission.config_updated');
    expect(configLogs).toHaveLength(1);
    const configDetails = JSON.parse(String(configLogs[0].details));
    expect(configDetails.before.commissionRateBps).toBe(500);
    expect(configDetails.after.commissionRateBps).toBe(750);
  });
});

describe('API authorization', () => {
  it('driver earnings API: 401 signed out, 403 for students, 200 for the driver', async () => {
    await cleanDatabase();
    await resetConfig();
    const { user: driverUser, driver } = await makeDriver();
    const { trip } = await makeTrip(driverUser.id);
    await accrueEarningForTrip(trip.id);

    signOut();
    const unauth = await driverGET(apiReq('http://localhost/api/commission/driver'));
    expect(unauth.status).toBe(401);

    const student = await createTestStudent();
    signInAs({ id: student.id, email: student.email, role: 'STUDENT' });
    const forbidden = await driverGET(apiReq('http://localhost/api/commission/driver'));
    expect(forbidden.status).toBe(403);

    signInAs({ id: driverUser.id, email: driverUser.email, role: 'DRIVER' });
    const ok = await driverGET(apiReq('http://localhost/api/commission/driver'));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.summary.driverId).toBe(driver.id);
    expect(body.summary.commissionKobo).toBe(4000);
    expect(body.rows).toHaveLength(1);
  });

  it('admin APIs: 403 for drivers, 200 for admins', async () => {
    await cleanDatabase();
    await resetConfig();
    const { user: driverUser } = await makeDriver();

    signInAs({ id: driverUser.id, email: driverUser.email, role: 'DRIVER' });
    expect((await summaryGET(apiReq('http://localhost/api/commission/summary'))).status).toBe(403);
    expect(
      (await settlementsGET(apiReq('http://localhost/api/commission/settlements'))).status
    ).toBe(403);

    const admin = await makeAdmin();
    signInAs({ id: admin.id, email: admin.email, role: 'ADMIN' });
    const ok = await summaryGET(apiReq('http://localhost/api/commission/summary'));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.global).toHaveProperty('totalOutstandingKobo');
    expect(body.config.commissionRateBps).toBe(500);
  });

  it('commission config: admin can change the rate, invalid rates rejected', async () => {
    await cleanDatabase();
    await resetConfig();

    const student = await createTestStudent();
    signInAs({ id: student.id, email: student.email, role: 'STUDENT' });
    const forbidden = await configPATCH(
      apiReq('http://localhost/api/commission/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ commissionRateBps: 1000 }),
      })
    );
    expect(forbidden.status).toBe(403);

    const admin = await makeAdmin();
    signInAs({ id: admin.id, email: admin.email, role: 'ADMIN' });

    const fullBody = {
      businessTimezone: 'Africa/Lagos',
      settlementHourLocal: 1,
      autoSettlementEnabled: false,
      manualApprovalRequired: true,
      minSettlementKobo: 0,
      recipientBankCode: null,
      recipientBankName: null,
      recipientAccountNumber: null,
      recipientAccountName: null,
    };

    // 7.77% = 777 bps — not a multiple of the 25 bps step.
    const invalid = await configPATCH(
      apiReq('http://localhost/api/commission/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...fullBody, commissionRateBps: 777 }),
      })
    );
    expect(invalid.status).toBe(400);

    const valid = await configPATCH(
      apiReq('http://localhost/api/commission/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...fullBody, commissionRateBps: 1000 }),
      })
    );
    expect(valid.status).toBe(200);
    const body = await valid.json();
    expect(body.config.commissionRateBps).toBe(1000);

    const stored = await prisma.commissionConfig.findUnique({ where: { id: 1 } });
    expect(stored!.commissionRateBps).toBe(1000);
  });

  it('scheduled settlement endpoint requires the cron secret', async () => {
    await cleanDatabase();
    await resetConfig();

    const noSecret = await runGET(apiReq('http://localhost/api/commission/settlements/run'));
    expect(noSecret.status).toBe(401);

    const wrongSecret = await runGET(
      apiReq('http://localhost/api/commission/settlements/run', {
        headers: { authorization: 'Bearer wrong-secret' },
      })
    );
    expect(wrongSecret.status).toBe(401);

    const correct = await runGET(
      apiReq('http://localhost/api/commission/settlements/run', {
        headers: { authorization: 'Bearer test-cron-secret' },
      })
    );
    expect(correct.status).toBe(200);
    const body = await correct.json();
    expect(body.ran).toBe(true);
    expect(body.transferInitiated).toBe(false); // auto settlement disabled by default
  });

  it('manual settlement endpoint is admin-only', async () => {
    await cleanDatabase();
    await resetConfig();
    const student = await createTestStudent();
    signInAs({ id: student.id, email: student.email, role: 'STUDENT' });

    const forbidden = await runPOST(
      apiReq('http://localhost/api/commission/settlements/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    );
    expect(forbidden.status).toBe(403);
  });
});
