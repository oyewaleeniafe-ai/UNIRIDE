/**
 * Development-only Flutterwave sandbox harness.
 *
 * This lets the full booking → checkout → verification flow run locally when
 * real Flutterwave credentials are absent. It NEVER runs in production or in
 * tests: `sandboxEnabled()` requires NODE_ENV === 'development' (the Next.js
 * dev server) AND an explicit FLUTTERWAVE_SANDBOX=1 opt-in. NODE_ENV is
 * 'production' under `next build/start` and 'test' under vitest, so a
 * production build and the test suite always stay on the real gateway code
 * path even if the flag leaks into the environment (Prisma's client
 * auto-loads the project .env, which can happen in tests).
 *
 * No real money moves: amounts live only in an in-process map.
 */

type SandboxSession = {
  reference: string;
  amount: number; // major units (NGN), as Flutterwave reports
  currency: string;
  paid: boolean;
};

const globalStore = globalThis as typeof globalThis & {
  __ccabSandboxPayments?: Map<string, SandboxSession>;
};

function store(): Map<string, SandboxSession> {
  if (!globalStore.__ccabSandboxPayments) {
    globalStore.__ccabSandboxPayments = new Map();
  }
  return globalStore.__ccabSandboxPayments;
}

export function sandboxEnabled(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.FLUTTERWAVE_SANDBOX === '1';
}

export function createSandboxSession(reference: string, amount: number): SandboxSession {
  const session: SandboxSession = {
    reference,
    amount: Math.round(amount * 100) / 100,
    currency: 'NGN',
    paid: false,
  };
  store().set(reference, session);
  return session;
}

export function getSandboxSession(reference: string): SandboxSession | undefined {
  return store().get(reference);
}

/** Simulate the student completing payment on the mock checkout page. */
export function markSandboxSessionPaid(reference: string): SandboxSession | undefined {
  const session = store().get(reference);
  if (!session) return undefined;
  session.paid = true;
  return session;
}
