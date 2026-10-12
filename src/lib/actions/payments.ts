'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { calculateFare } from '@/lib/fares';
import { createPayment, verifyPayment, createPayoutForTrip } from '@/lib/payments';
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
 * Initialize a payment for a trip via Flutterwave.
 *
 * Server calculates the fare from the trip's stored ride type — it never
 * trusts the frontend's amount. CampusCab only supports Flutterwave.
 */
export async function initializePayment(
  tripId: string
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

  if (trip.rideType !== 'SOLO_QUICK_CAB' && trip.rideType !== 'SHARED_SHUTTLE') {
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

  const fare = calculateFare(trip.rideType);

  // The Payment row (including reuse of any pending row for this trip) is
  // persisted inside createPayment in the payment facade — one authoritative
  // record per initialization, so no duplicate payment rows are created.
  return createPayment({
    tripId,
    userId,
    passengerCount: trip.passengerCount,
    rideFare: fare.rideFare,
    platformFee: fare.platformFee,
    totalAmount: fare.totalAmount,
    email: session.user.email || '',
  });
}

/**
 * Verify a payment after the Flutterwave callback.
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

  const providerResult = await verifyPayment(reference);

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
 *
 * Only drivers and admins may initiate payouts, and only for trips with a
 * successful payment on file. Payouts are not automatic — they require
 * FLUTTERWAVE_TRANSFERS_ENABLED=1 on the Flutterwave dashboard.
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

  if (userRole !== 'DRIVER' && userRole !== 'ADMIN') {
    return { error: 'Only drivers and admins can initiate payouts.' };
  }

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });

  if (!trip) {
    return { error: 'Trip not found.' };
  }

  if (!trip.driverId) {
    return { error: 'This trip has no assigned driver.' };
  }

  // Only the assigned driver or admin can initiate the payout.
  // trip.driverId is the Driver record id (relation target), not the user id.
  const driver = await prisma.driver.findUnique({ where: { id: trip.driverId } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isAssignedDriver = driver?.userId === (session?.user as any)?.id;

  if (!isAssignedDriver && userRole !== 'ADMIN') {
    return { error: 'You can only initiate payouts for your own trips.' };
  }

  const payment = trip.payments[0];
  if (!payment || payment.status !== 'SUCCESSFUL') {
    return { error: 'No successful payment found for this trip.' };
  }

  // Guard: do not trigger payouts for unpaid/cancelled trips.
  if (trip.status !== 'COMPLETED') {
    return { error: 'This trip is not completed. Payouts require a completed trip.' };
  }

  const result = await createPayoutForTrip({
    tripId,
    paymentId: payment.id,
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
      provider: 'FLUTTERWAVE',
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
