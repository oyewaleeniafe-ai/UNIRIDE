import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPayment } from '@/lib/payments';

export const dynamic = 'force-dynamic';

const DEEP_LINK = 'campuscab://payment';

/**
 * Flutterwave checkout return target for the native app.
 *
 * The browser is handed back to the app with a deep link. The status is decided
 * here, server-side — verification is repeated against Flutterwave rather than
 * trusting the query parameters the browser arrived with. The app then reloads
 * the ride from the API, so a spoofed deep link can never show a paid ride.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const reference = url.searchParams.get('tx_ref') ?? url.searchParams.get('reference');
  const providerStatus = url.searchParams.get('status') ?? '';

  let status: 'successful' | 'failed' | 'pending' | 'unknown' = 'unknown';

  if (reference) {
    const payment = await prisma.payment.findUnique({ where: { reference } });

    if (!payment) {
      status = 'unknown';
    } else if (payment.status === 'SUCCESSFUL') {
      status = 'successful';
    } else if (providerStatus === 'cancelled' || providerStatus === 'failed') {
      status = 'failed';
    } else {
      const result = await verifyPayment(reference);
      if (result.success) {
        status = 'successful';
      } else {
        const fresh = await prisma.payment.findUnique({ where: { reference } });
        status = fresh?.status === 'FAILED' ? 'failed' : 'pending';
      }
    }
  }

  const params = new URLSearchParams({ status });
  if (reference) params.set('reference', reference);

  return NextResponse.redirect(`${DEEP_LINK}?${params.toString()}`, 302);
}
