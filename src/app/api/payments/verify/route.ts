import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPayment } from '@/lib/payments';
import { logAudit } from '@/lib/audit';

/**
 * Payment callback route.
 *
 * Used by both PalmPay and OPay after the student completes (or cancels) the
 * checkout flow. We verify the payment server-side using the provider record
 * attached to the payment, never trusting the frontend callback alone.
 *
 * Redirects:
 *  /student/rides?payment=success
 *  /student/rides?payment=failed
 *  /student/rides?payment=error&reason=...
 */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const reference = searchParams.get('reference');

  if (!reference) {
    return NextResponse.redirect(
      new URL('/student/rides?payment=error&reason=no_reference', request.url)
    );
  }

  try {
    const payment = await prisma.payment.findUnique({ where: { reference } });

    if (!payment) {
      return NextResponse.redirect(
        new URL('/student/rides?payment=error&reason=not_found', request.url)
      );
    }

    if (payment.status === 'SUCCESSFUL') {
      return NextResponse.redirect(
        new URL('/student/rides?payment=success', request.url)
      );
    }

    const provider = (payment.provider ?? 'PALMPAY') as 'PALMPAY' | 'OPAY';
    const providerRef = payment.providerReference ?? reference;

    const result = await verifyPayment(providerRef, provider);

    if (result.success) {
      return NextResponse.redirect(
        new URL('/student/rides?payment=success', request.url)
      );
    }

    if (result.pending) {
      return NextResponse.redirect(
        new URL('/student/rides?payment=pending', request.url)
      );
    }

    return NextResponse.redirect(
      new URL('/student/rides?payment=failed', request.url)
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed';
    console.error('[PAYMENT] Verification error:', message);

    return NextResponse.redirect(
      new URL('/student/rides?payment=error&reason=verification_failed', request.url)
    );
  }
}
