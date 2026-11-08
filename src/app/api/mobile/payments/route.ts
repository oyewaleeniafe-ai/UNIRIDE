import { NextResponse } from 'next/server';
import { fail, json, limit, readJson, requireAccount } from '@/lib/mobile/http';
import { initPayment, verifyPaymentForAccount } from '@/lib/mobile/service';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://campuscab-pi.vercel.app';

/**
 * Mobile checkout.
 *
 *  { action: 'init', tripId }   → hosted Flutterwave checkout URL
 *  { action: 'verify', reference } → server-side verification result
 *
 * The app opens the checkout URL in a browser and then calls verify. A ride is
 * only ever marked paid by the server, either here or by the webhook.
 */
export async function POST(request: Request) {
  const account = await requireAccount(request, ['STUDENT', 'ADMIN']);
  if (account instanceof NextResponse) return account;

  const blocked = limit(request, RATE_LIMITS.payment, 'mobile-payment');
  if (blocked) return blocked;

  const body = await readJson<{ action?: string; tripId?: string; reference?: string }>(request);
  if (!body?.action) return fail('Missing action.', 400);

  if (body.action === 'init') {
    if (!body.tripId) return fail('tripId is required.', 400);

    const result = await initPayment(
      account,
      body.tripId,
      `${APP_URL}/api/payments/mobile-return`
    );
    if ('error' in result) return fail(result.error ?? 'Request failed.', 400);
    return json(result);
  }

  if (body.action === 'verify') {
    if (!body.reference) return fail('reference is required.', 400);
    const result = await verifyPaymentForAccount(account, body.reference);
    if ('error' in result && !('status' in result)) return fail(result.error ?? 'Request failed.', 400);
    return json(result);
  }

  return fail('Unknown action.', 400);
}
