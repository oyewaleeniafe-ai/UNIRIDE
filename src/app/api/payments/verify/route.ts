import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyTransaction } from '@/lib/paystack';
import { logAudit } from '@/lib/audit';

/**
 * Paystack callback URL.
 * Paystack redirects here after payment.
 * We verify server-side and redirect to the student's rides page.
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
    // Find the payment record
    const payment = await prisma.payment.findUnique({
      where: { reference },
    });

    if (!payment) {
      return NextResponse.redirect(
        new URL('/student/rides?payment=error&reason=not_found', request.url)
      );
    }

    // Idempotent: if already successful, skip verification
    if (payment.status === 'SUCCESSFUL') {
      return NextResponse.redirect(
        new URL('/student/rides?payment=success', request.url)
      );
    }

    // Verify with Paystack server-side
    const verification = await verifyTransaction(reference);

    if (verification.data.status === 'success') {
      // Verify the amount matches (tamper protection)
      const expectedAmountInKobo = Math.round(payment.totalAmount * 100);
      if (verification.data.amount !== expectedAmountInKobo) {
        logAudit({
          action: 'payment.amount_mismatch',
          entity: 'Payment',
          entityId: payment.id,
          details: {
            expected: expectedAmountInKobo,
            received: verification.data.amount,
          },
        }).catch(() => {});

        return NextResponse.redirect(
          new URL('/student/rides?payment=error&reason=amount_mismatch', request.url)
        );
      }

      // Mark payment as successful
      await prisma.$transaction([
        prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'SUCCESSFUL',
            paystackReference: String(verification.data.id),
            paidAt: new Date(verification.data.paid_at),
          },
        }),
        prisma.trip.update({
          where: { id: payment.tripId },
          data: {
            appCharge: payment.appCharge,
            driverEarnings: payment.rideFare,
          },
        }),
      ]);

      logAudit({
        userId: payment.userId,
        action: 'payment.successful',
        entity: 'Payment',
        entityId: payment.id,
        details: {
          tripId: payment.tripId,
          totalAmount: payment.totalAmount,
          rideFare: payment.rideFare,
          appCharge: payment.appCharge,
          paystackTransactionId: verification.data.id,
        },
      }).catch(() => {});

      return NextResponse.redirect(
        new URL('/student/rides?payment=success', request.url)
      );
    } else {
      // Payment failed
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          failureReason: verification.data.gateway_response || 'Payment was not successful',
        },
      });

      return NextResponse.redirect(
        new URL('/student/rides?payment=failed', request.url)
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed';
    console.error('[PAYMENT] Verification error:', message);

    return NextResponse.redirect(
      new URL('/student/rides?payment=error&reason=verification_failed', request.url)
    );
  }
}
