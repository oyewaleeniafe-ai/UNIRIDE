'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import {
  calculateFare,
  initializeTransaction,
  verifyTransaction,
  generatePaymentReference,
} from '@/lib/paystack';
import { logAudit } from '@/lib/audit';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { headers } from 'next/headers';

async function getRateLimitId(): Promise<string> {
  const h = await headers();
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    h.get('cf-connecting-ip') ||
    'unknown'
  );
}

/**
 * Initialize a payment for a trip.
 * Server calculates the fare — never trusts frontend amounts.
 */
export async function initializePayment(tripId: string) {
  const rateLimitId = await getRateLimitId();
  const limit = checkRateLimit(rateLimitId, RATE_LIMITS.payment);
  if (!limit.allowed) {
    return { error: 'Too many payment requests. Please try again later.' };
  }

  const session = await auth();
  if (!session?.user) {
    return { error: 'You must be logged in to make a payment.' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId = (session.user as any).id as string;

  // Verify the user owns this trip
  const student = await prisma.student.findUnique({ where: { userId } });
  if (!student) {
    return { error: 'Student profile not found.' };
  }

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) {
    return { error: 'Trip not found.' };
  }
  if (trip.studentId !== student.id) {
    return { error: 'You can only pay for your own trips.' };
  }
  if (trip.status !== 'PENDING') {
    return { error: 'This trip is no longer accepting payments.' };
  }

  // SECURITY: derive passenger count from the trip record — never from the
  // client. Otherwise a caller could initialize a ₦230 payment for a
  // 3-passenger trip by passing passengerCount=1.
  const passengerCount = trip.passengerCount;
  if (passengerCount < 1 || passengerCount > 10) {
    return { error: 'Invalid passenger count on this trip.' };
  }

  // Check for existing successful payment (idempotent)
  const existingPayment = await prisma.payment.findFirst({
    where: {
      tripId,
      userId,
      status: 'SUCCESSFUL',
    },
  });
  if (existingPayment) {
    return { error: 'This trip has already been paid for.' };
  }

  // Check for existing pending payment
  const pendingPayment = await prisma.payment.findFirst({
    where: {
      tripId,
      userId,
      status: 'PENDING',
    },
  });

  // Reuse existing pending payment reference if still valid
  if (pendingPayment) {
    const payRef = pendingPayment.paystackReference;
    if (payRef) {
      // Verify its status with Paystack before returning
      try {
        const verification = await verifyTransaction(pendingPayment.reference);
        if (verification.data.status === 'success') {
          // Already paid - mark as successful
          await markPaymentSuccessful(pendingPayment.id, verification.data);
          return { error: 'This trip has already been paid for.' };
        }
      } catch {
        // Paystack verification failed — allow re-initialization
      }
    }

    // Refresh the fare from the trip's (server-side) passenger count.
    // The reference must stay STABLE — regenerating it would desync the
    // Paystack transaction from our record and break callback verification.
    const fare = calculateFare(passengerCount);
    await prisma.payment.update({
      where: { id: pendingPayment.id },
      data: {
        passengerCount,
        rideFare: fare.rideFare,
        appCharge: fare.appCharge,
        totalAmount: fare.totalAmount,
      },
    });

    return createPaystackTransaction(pendingPayment.id, pendingPayment.reference, passengerCount, session.user.email || '');
  }

  // Server-side fare calculation
  const fare = calculateFare(passengerCount);

  // Create payment record
  const reference = generatePaymentReference();
  const payment = await prisma.payment.create({
    data: {
      userId,
      tripId,
      reference,
      passengerCount,
      rideFare: fare.rideFare,
      appCharge: fare.appCharge,
      totalAmount: fare.totalAmount,
      currency: 'NGN',
      status: 'PENDING',
    },
  });

  logAudit({
    userId,
    action: 'payment.initialized',
    entity: 'Payment',
    entityId: payment.id,
    details: {
      tripId,
      passengerCount,
      rideFare: fare.rideFare,
      appCharge: fare.appCharge,
      totalAmount: fare.totalAmount,
      reference,
    },
  }).catch(() => {});

  return createPaystackTransaction(payment.id, reference, passengerCount, session.user.email || '');
}

async function createPaystackTransaction(
  paymentId: string,
  reference: string,
  passengerCount: number,
  email: string
) {
  try {
    const fare = calculateFare(passengerCount);
    const amountInKobo = Math.round(fare.totalAmount * 100); // Convert naira to kobo

    const result = await initializeTransaction(email, amountInKobo, reference, {
      payment_id: paymentId,
      passenger_count: passengerCount,
    });

    // Store the Paystack access code
    await prisma.payment.update({
      where: { id: paymentId },
      data: { paystackReference: result.data.access_code },
    });

    return {
      success: true,
      authorizationUrl: result.data.authorization_url,
      reference,
      accessCode: result.data.access_code,
      amount: fare.totalAmount,
      breakdown: {
        rideFare: fare.rideFare,
        appCharge: fare.appCharge,
        totalAmount: fare.totalAmount,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Payment initialization failed';
    logAudit({
      action: 'payment.error',
      entity: 'Payment',
      entityId: paymentId,
      details: { error: message, reference },
    }).catch(() => {});
    return { error: message };
  }
}

/**
 * Verify a payment after Paystack callback.
 * Server-side verification — never trusts the frontend.
 */
export async function verifyPayment(reference: string) {
  const rateLimitId = await getRateLimitId();
  const limit = checkRateLimit(rateLimitId, RATE_LIMITS.payment);
  if (!limit.allowed) {
    return { error: 'Too many verification requests. Please try again later.' };
  }

  const session = await auth();
  if (!session?.user) {
    return { error: 'You must be logged in.' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId = (session.user as any).id as string;

  const payment = await prisma.payment.findUnique({
    where: { reference },
  });

  if (!payment) {
    return { error: 'Payment not found.' };
  }

  if (payment.userId !== userId) {
    return { error: 'Unauthorized.' };
  }

  // Idempotent: if already successful, return success without re-verifying
  if (payment.status === 'SUCCESSFUL') {
    return {
      success: true,
      message: 'Payment already verified.',
      paymentId: payment.id,
    };
  }

  // Verify with Paystack server-side
  try {
    const verification = await verifyTransaction(reference);

    if (verification.data.status === 'success') {
      // Verify the amount matches server-calculated amount (tamper protection)
      const expectedAmountInKobo = Math.round(payment.totalAmount * 100);
      if (verification.data.amount !== expectedAmountInKobo) {
        logAudit({
          userId,
          action: 'payment.amount_mismatch',
          entity: 'Payment',
          entityId: payment.id,
          details: {
            expected: expectedAmountInKobo,
            received: verification.data.amount,
          },
        }).catch(() => {});
        return { error: 'Payment amount mismatch. Please contact support.' };
      }

      await markPaymentSuccessful(payment.id, verification.data);

      return {
        success: true,
        message: 'Payment successful.',
        paymentId: payment.id,
      };
    } else {
      // Payment failed
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          failureReason: verification.data.gateway_response || 'Payment was not successful',
        },
      });

      logAudit({
        userId,
        action: 'payment.failed',
        entity: 'Payment',
        entityId: payment.id,
        details: {
          reference,
          gateway_response: verification.data.gateway_response,
          status: verification.data.status,
        },
      }).catch(() => {});

      return { error: verification.data.gateway_response || 'Payment was not successful.' };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed';
    return { error: `Payment verification failed: ${message}` };
  }
}

async function markPaymentSuccessful(
  paymentId: string,
  paystackData: {
    id: number;
    status: string;
    paid_at: string;
    gateway_response: string;
  }
) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return;

  // Idempotent check — don't re-process if already successful
  if (payment.status === 'SUCCESSFUL') return;

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'SUCCESSFUL',
        paystackReference: String(paystackData.id),
        paidAt: new Date(paystackData.paid_at),
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
    entityId: paymentId,
    details: {
      tripId: payment.tripId,
      totalAmount: payment.totalAmount,
      rideFare: payment.rideFare,
      appCharge: payment.appCharge,
      paystackTransactionId: paystackData.id,
    },
  }).catch(() => {});
}

/**
 * Get payment status for a trip.
 */
export async function getPaymentStatus(tripId: string) {
  const session = await auth();
  if (!session?.user) {
    return { payment: null };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId = (session.user as any).id as string;

  const payment = await prisma.payment.findFirst({
    where: { tripId, userId },
    orderBy: { createdAt: 'desc' },
  });

  return { payment };
}
