import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPayment } from '@/lib/payments';
import { logAudit } from '@/lib/audit';

/**
 * Flutterwave Standard checkout callback route.
 *
 * After the student completes (or cancels) checkout, Flutterwave redirects
 * here with status/tx_ref/transaction_id query parameters. We verify the
 * payment server-side using tx_ref, never trusting the frontend redirect alone.
 *
 * Redirects:
 *  /student/rides?payment=success
 *  /student/rides?payment=failed
 *  /student/rides?payment=pending
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

    // Verify with Flutterwave server-side using tx_ref.
    const result = await verifyPayment(reference);

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

