import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { prisma, cleanDatabase, createTestStudent, createTestDriver, getTestLocation } from './setup';
import { requestDriverPayout, saveDriverBankAccount } from '@/lib/actions/driver';

/**
 * Driver payout tests: saving bank details and requesting a payment of unpaid
 * net earnings. No Flutterwave transfer is enabled here, so the important
 * guarantee under test is that a failed/blocked request never moves money and
 * never fabricates a payout row.
 */

const sessionState = vi.hoisted(() => ({
  user: null as { id: string; email: string; role: string } | null,
}));

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () => (sessionState.user ? { user: { ...sessionState.user } } : null)),
  getUserId: vi.fn(async () => {
    throw new Error('Not authenticated');
  }),
  getUserRole: vi.fn(async () => {
    throw new Error('Not authenticated');
  }),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/prisma', async () => {
  const setup = await import('./setup');
  return { prisma: setup.prisma };
});

function signInAs(user: { id: string; email: string; role: string }) {
  sessionState.user = user;
}

async function makeDriverWithEarning(netKobo = 60_000) {
  const user = await createTestDriver({ email: `payout-${Date.now()}-${Math.random()}@test.com` });
  const driver = await prisma.driver.findUnique({ where: { userId: user.id } });
  if (!driver) throw new Error('driver fixture missing');

  const student = await createTestStudent();
  const pickup = await getTestLocation('Payout Pickup');
  const dropoff = await getTestLocation('Payout Dropoff');

  const trip = await prisma.trip.create({
    data: {
      studentId: student.student.id,
      driverId: driver.id,
      pickupLocationId: pickup.id,
      dropoffLocationId: dropoff.id,
      rideType: 'SOLO_QUICK_CAB',
      passengerCount: 1,
      totalFare: 810,
      appCharge: 10,
      driverEarnings: 800,
      status: 'COMPLETED',
    },
  });

  const payment = await prisma.payment.create({
    data: {
      userId: student.id,
      tripId: trip.id,
      reference: `ccab-payout-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      passengerCount: 1,
      rideFare: 800,
      platformFee: 10,
      totalAmount: 810,
      currency: 'NGN',
      status: 'SUCCESSFUL',
      paidAt: new Date(),
    },
  });

  const earning = await prisma.driverEarning.create({
    data: {
      driverId: driver.id,
      tripId: trip.id,
      paymentId: payment.id,
      paymentReference: payment.reference,
      eligibleAmountKobo: 80_000,
      commissionRateBps: 2500,
      commissionAmountKobo: 20_000,
      netAmountKobo: netKobo,
      earningDate: new Date(),
      businessTimezone: 'Africa/Lagos',
      status: 'ACCRUED',
      payoutStatus: 'UNPAID',
    },
  });

  return { user, driver, trip, payment, earning };
}

describe('driver payouts', () => {
  const originalTransfersFlag = process.env.FLUTTERWAVE_TRANSFERS_ENABLED;

  beforeAll(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    if (originalTransfersFlag === undefined) {
      delete process.env.FLUTTERWAVE_TRANSFERS_ENABLED;
    } else {
      process.env.FLUTTERWAVE_TRANSFERS_ENABLED = originalTransfersFlag;
    }
    await cleanDatabase();
  });

  afterEach(() => {
    sessionState.user = null;
    delete process.env.FLUTTERWAVE_TRANSFERS_ENABLED;
  });

  it('rejects a bank code that is not in the supported list', async () => {
    const { user, driver } = await makeDriverWithEarning();
    signInAs({ id: user.id, email: user.email, role: 'DRIVER' });

    const result = await saveDriverBankAccount({
      bankCode: '999999',
      accountNumber: '0123456789',
      accountName: 'Ada Driver',
    });

    expect('error' in result && result.error).toContain('supported bank');
    expect(await prisma.driverPaymentAccount.findUnique({ where: { driverId: driver.id } })).toBeNull();
  });

  it('rejects an account number that is not 10 digits', async () => {
    const { user } = await makeDriverWithEarning();
    signInAs({ id: user.id, email: user.email, role: 'DRIVER' });

    const result = await saveDriverBankAccount({
      bankCode: '058',
      accountNumber: '12345',
      accountName: 'Ada Driver',
    });

    expect('error' in result && result.error).toContain('10 digits');
  });

  it('saves the bank account and resolves the bank name from the code', async () => {
    const { user, driver } = await makeDriverWithEarning();
    signInAs({ id: user.id, email: user.email, role: 'DRIVER' });

    const result = await saveDriverBankAccount({
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'Ada Driver',
    });

    expect('success' in result && result.success).toBe(true);

    const saved = await prisma.driverPaymentAccount.findUnique({ where: { driverId: driver.id } });
    expect(saved).toMatchObject({
      provider: 'FLUTTERWAVE',
      bankCode: '058',
      bankName: 'Guaranty Trust Bank (GTBank)',
      accountNumber: '0123456789',
      accountName: 'Ada Driver',
      verificationStatus: 'PENDING',
      isActive: true,
    });
  });

  it('refuses to request a payout before bank details are saved', async () => {
    const { user } = await makeDriverWithEarning();
    signInAs({ id: user.id, email: user.email, role: 'DRIVER' });

    const result = await requestDriverPayout();

    expect('error' in result && result.error).toContain('bank account details');
  });

  it('creates no payout and leaves earnings unpaid while transfers are disabled', async () => {
    const { user, driver, trip, earning } = await makeDriverWithEarning();
    signInAs({ id: user.id, email: user.email, role: 'DRIVER' });

    await prisma.driverPaymentAccount.create({
      data: {
        driverId: driver.id,
        provider: 'FLUTTERWAVE',
        bankCode: '058',
        bankName: 'Guaranty Trust Bank (GTBank)',
        accountNumber: '0123456789',
        accountName: 'Ada Driver',
        verificationStatus: 'PENDING',
      },
    });

    const result = await requestDriverPayout();

    expect('error' in result && result.error).toContain('not been verified');
    expect(await prisma.payout.count({ where: { tripId: trip.id } })).toBe(0);

    const unchanged = await prisma.driverEarning.findUnique({ where: { id: earning.id } });
    expect(unchanged?.payoutStatus).toBe('UNPAID');
  });

  it('creates no payout and leaves earnings unpaid while transfers are disabled', async () => {
    const { user, driver, trip, earning } = await makeDriverWithEarning();
    signInAs({ id: user.id, email: user.email, role: 'DRIVER' });

    await prisma.driverPaymentAccount.create({
      data: {
        driverId: driver.id,
        provider: 'FLUTTERWAVE',
        bankCode: '058',
        bankName: 'Guaranty Trust Bank (GTBank)',
        accountNumber: '0123456789',
        accountName: 'Ada Driver',
        // Verified accounts only: an unverified payee is refused earlier.
        verificationStatus: 'VERIFIED',
      },
    });

    const result = await requestDriverPayout();

    expect('error' in result && result.error).toContain('not live yet');
    expect(await prisma.payout.count({ where: { tripId: trip.id } })).toBe(0);

    const unchanged = await prisma.driverEarning.findUnique({ where: { id: earning.id } });
    expect(unchanged?.payoutStatus).toBe('UNPAID');
  });
});
