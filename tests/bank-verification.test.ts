import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { prisma, cleanDatabase, createTestDriver } from './setup';
import { saveDriverBankAccount } from '@/lib/actions/driver';

/**
 * Bank details are saved through Flutterwave's account-resolve endpoint, so
 * the payee name comes from the bank rather than from whatever the driver
 * typed. These tests cover the three outcomes: resolved (VERIFIED), rejected
 * by the provider (nothing saved), and lookup unavailable (saved PENDING).
 */

const sessionState = vi.hoisted(() => ({
  user: null as { id: string; email: string; role: string } | null,
}));

vi.hoisted(() => {
  process.env.FLUTTERWAVE_SECRET_KEY = 'FLWSECK_TEST_SECRET';
});

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

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/prisma', async () => {
  const setup = await import('./setup');
  return { prisma: setup.prisma };
});

const realFetch = globalThis.fetch;

function mockResolveResponse(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

async function signInDriver() {
  const user = await createTestDriver({ email: `bank-${Date.now()}-${Math.random()}@test.com` });
  const driver = await prisma.driver.findUnique({ where: { userId: user.id } });
  if (!driver) throw new Error('driver fixture missing');
  sessionState.user = { id: user.id, email: user.email, role: 'DRIVER' };
  return { user, driver };
}

describe('driver bank account verification', () => {
  beforeAll(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    await cleanDatabase();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    sessionState.user = null;
  });

  it('stores the account name returned by Flutterwave and marks it VERIFIED', async () => {
    const { driver } = await signInDriver();
    const fetchMock = mockResolveResponse({
      status: 'success',
      message: 'Account resolved',
      data: { account_number: '0123456789', account_name: 'ADA OKONKWO DRIVER' },
    });

    const result = await saveDriverBankAccount({
      bankCode: '058',
      accountNumber: '0123456789',
      // Deliberately wrong: the bank's name must win.
      accountName: 'Totally Different Name',
    });

    expect('success' in result && result.success).toBe(true);
    expect('bank' in result && result.bank.verified).toBe(true);
    expect('bank' in result && result.bank.accountName).toBe('ADA OKONKWO DRIVER');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/accounts/resolve');
    expect(JSON.parse(String(init.body))).toEqual({
      account_number: '0123456789',
      account_bank: '058',
    });

    const saved = await prisma.driverPaymentAccount.findUnique({ where: { driverId: driver.id } });
    expect(saved).toMatchObject({
      accountName: 'ADA OKONKWO DRIVER',
      verificationStatus: 'VERIFIED',
    });
  });

  it('refuses to save an account the provider rejects', async () => {
    const { driver } = await signInDriver();
    mockResolveResponse({ status: 'error', message: 'Account number not found' }, 400);

    const result = await saveDriverBankAccount({
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'Ada Driver',
    });

    expect('error' in result && result.error).toContain('Account number not found');
    expect(await prisma.driverPaymentAccount.findUnique({ where: { driverId: driver.id } })).toBeNull();
  });

  it('saves unverified details when the lookup cannot be reached', async () => {
    const { driver } = await signInDriver();
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const result = await saveDriverBankAccount({
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'Ada Driver',
    });

    expect('success' in result && result.success).toBe(true);
    expect('bank' in result && result.bank.verified).toBe(false);

    const saved = await prisma.driverPaymentAccount.findUnique({ where: { driverId: driver.id } });
    expect(saved).toMatchObject({
      accountName: 'Ada Driver',
      verificationStatus: 'PENDING',
    });
  });
});
