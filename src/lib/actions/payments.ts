'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { calculateFare } from '@/lib/fares';
import { createPayment, verifyPayment, createPayoutForTrip, type Provider } from '@/lib/payments';
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
 * Initialize a payment for a trip using the student's selected provider.
 *
 * The provider selection is part of the booking/payment flow now. If the
 * frontend does not pass a provider, default to PalmPay as the primary
 * provider. The backend still calculates the amount — it never trusts the
 * frontend's amount.
 */
export async function initializePayment(
  tripId: string,
  provider: Provider | 'PALMPAY' | 'OPAY' = 'PALMPAY'
): Promise<{
  success?: boolean;
  error?: string;
  checkoutUrl?: string;
  reference?: string;
  providerReference?: string | null;
  paymentId?: string;
  amount?: number;
  breakdown?: { rideFare: number; platformFee: number; totalAmount: number } | null;
  pending?: boolean;
}> {
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

  if (
    trip.rideType !== 'SOLO_QUICK_CAB' &&
    trip.rideType !== 'SHARED_SHUTTLE'
  ) {
    return { error: 'Invalid ride type on this trip.' };
  }

  const existingPayment = await prisma.payment.findFirst({
    where: { tripId, userId, status: 'SUCCESSFUL' },
  });
  if (existingPayment) {
    return {
      error: 'This trip has already been paid for.',
      providerReference: existingPayment.providerReference,
      paymentId: existingPayment.id,
    };
  }

  const pendingPayment = await prisma.payment.findFirst({
    where: { tripId, userId, status: 'PENDING' },
  });

  // The Trip model does not store a provider preference, so the provider is
  // always the student's explicit selection from the booking flow. Pending
  // payments are re-routed to that same provider on retry.
  const effectiveProvider: Provider =
    provider === 'PALMPAY' || provider === 'OPAY' ? provider : 'PALMPAY';

  if (pendingPayment) {
    const fare = calculateFare(trip.rideType);
    await prisma.payment.update({
      where: { id: pendingPayment.id },
      data: {
        rideFare: fare.rideFare,
        platformFee: fare.platformFee,
        totalAmount: fare.totalAmount,
        provider: effectiveProvider,
      },
    });

    const providerResult = await verifyPayment(
      pendingPayment.reference,
      effectiveProvider
    );

    if (providerResult.success && providerResult.alreadyVerified) {
      return {
        error: 'This trip has already been paid for.',
        providerReference: pendingPayment.providerReference,
        paymentId: pendingPayment.id,
      };
    }

    return createPayment({
      tripId: pendingPayment.tripId,
      userId: pendingPayment.userId,
      provider: effectiveProvider,
      passengerCount: pendingPayment.passengerCount,
      rideFare: fare.rideFare,
      platformFee: fare.platformFee,
      totalAmount: fare.totalAmount,
      email: session.user.email || '',
    });
  }

  const fare = calculateFare(trip.rideType);

  const payment = await prisma.payment.create({
    data: {
      userId,
      tripId,
      reference: `ccab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      passengerCount: trip.passengerCount,
      rideFare: fare.rideFare,
      platformFee: fare.platformFee,
      totalAmount: fare.totalAmount,
      currency: 'NGN',
      status: 'PENDING',
      provider: effectiveProvider,
    },
  });

  logAudit({
    userId,
    action: 'payment.initialized',
    entity: 'Payment',
    entityId: payment.id,
    details: {
      tripId,
      passengerCount: trip.passengerCount,
      rideFare: fare.rideFare,
      platformFee: fare.platformFee,
      totalAmount: fare.totalAmount,
      provider: effectiveProvider,
    },
  }).catch(() => {});

  return createPayment({
    tripId: payment.tripId,
    userId: payment.userId,
    provider: effectiveProvider,
    passengerCount: payment.passengerCount,
    rideFare: fare.rideFare,
    platformFee: fare.platformFee,
    totalAmount: fare.totalAmount,
    email: session.user.email || '',
  });
}



/**
 * Verify a payment after the provider callback.
 * Server-side verification — never trusts the frontend alone.
 */
export async function verifyPaymentHandler(reference: string) {
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

  const payment = await prisma.payment.findUnique({ where: { reference } });

  if (!payment) {
    return { error: 'Payment not found.' };
  }

  if (payment.userId !== userId) {
    return { error: 'Unauthorized.' };
  }

  if (payment.status === 'SUCCESSFUL') {
    return {
      success: true,
      message: 'Payment already verified.',
      paymentId: payment.id,
      providerReference: payment.providerReference,
    };
  }

  const providerResult = await verifyPayment(reference, payment.provider as Provider);

  if (providerResult.success) {
    return {
      success: true,
      message: providerResult.alreadyVerified ? 'Payment already verified.' : 'Payment successful.',
      paymentId: payment.id,
      providerReference: payment.providerReference,
    };
  }

  return { error: providerResult.error };
}

/**
 * Initiate a driver payout for a completed trip.
 * Used by driver/admin flows once payouts are approved for the merchant account.
 */
export async function initiateDriverPayout(tripId: string) {
  const rateLimitId = await getRateLimitId();
  const limit = checkRateLimit(rateLimitId, RATE_LIMITS.payment);
  if (!limit.allowed) {
    return { error: 'Too many payout requests. Please try again later.' };
  }

  const session = await auth();
  if (!session?.user) {
    return { error: 'You must be logged in.' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userRole = (session.user as any).role;

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });

  if (!trip) {
    return { error: 'Trip not found.' };
  }

  const payment = trip.payments[0];
  if (!payment || payment.status !== 'SUCCESSFUL') {
    return { error: 'No successful payment found for this trip.' };
  }

  if (userRole !== 'STUDENT' && userRole !== 'DRIVER' && userRole !== 'ADMIN') {
    return { error: 'You are not authorized to initiate payouts.' };
  }

  const result = await createPayoutForTrip({
    tripId,
    paymentId: payment.id,
    provider: payment.provider as Provider,
  });

  if (result.error) {
    return { error: result.error };
  }

  logAudit({
    userId: trip.studentId,
    action: 'payout.initiated',
    entity: 'Payout',
    entityId: result.payoutId,
    details: {
      tripId,
      paymentId: payment.id,
      provider: payment.provider,
      amount: payment.rideFare,
    },
  }).catch(() => {});

  return {
    success: true,
    payoutId: result.payoutId,
    providerReference: result.providerReference,
    status: result.status,
  };
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
    include: { trip: true },
  });

  return { payment };
}
