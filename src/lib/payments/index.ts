/**
 * CampusCab payment service facade.
 *
 * CampusCab uses Flutterwave as the only payment provider. This is the only
 * module most of the app should import for provider-backed payment operations.
 *
 * Payment amounts are never trusted from the client — they are recalculated
 * server-side from the trip's stored ride type before initialization or
 * verification.
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import {
  createPayment as createFlutterwavePayment,
  verifyPayment as verifyFlutterwavePayment,
  verifyWebhookSignature as verifyFlutterwaveSignature,
  normalizeWebhookEvent as normalizeFlutterwaveEvent,
  createPayout as createFlutterwavePayout,
} from './flutterwave';
import type {
  Provider,
  PayoutRecipient,
  PayoutResult,
  WebhookEvent,
} from './types';

export type { Provider } from './types';
export { maskAccountNumber, FLUTTERWAVE_WEBHOOK_HEADER } from './types';

/**
 * Build the amount in Flutterwave's smallest currency unit (kobo).
 * CampusCab amounts are stored in NGN; Flutterwave expects integer kobo for
 * payment init/verify. Transfers use NGN units (not kobo), handled in the adapter.
 */
export function toProviderAmount(naira: number): number {
  return Math.round(naira * 100);
}

/**
 * Every payment must use the Flutterwave provider. The provider value is still
 * stored on the Payment record so historical data and any future provider work
 * stays compatible, but CampusCab currently only supports FLUTTERWAVE.
 */
export const DEFAULT_PROVIDER: Provider = 'FLUTTERWAVE';

/**
 * Create a CampusCab payment via Flutterwave.
 *
 * Persists a Payment record first so the webhook and verify flows can be
 * idempotent and tamper-protected.
 */
export async function createPayment({
  tripId,
  userId,
  passengerCount,
  rideFare,
  platformFee,
  totalAmount,
  email,
}: {
  tripId: string;
  userId: string;
  passengerCount: number;
  rideFare: number;
  platformFee: number;
  totalAmount: number;
  email: string;
}) {
  const existing = await prisma.payment.findFirst({
    where: { tripId, userId, status: 'SUCCESSFUL' },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    return {
      success: false as const,
      error: 'This trip has already been paid for.',
      providerReference: existing.providerReference,
      paymentId: existing.id,
    };
  }

  const reference = `ccab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const amountInKobo = toProviderAmount(totalAmount);

  // Reuse any pending row for this trip instead of creating a duplicate
  // payment record. A fresh reference is issued for the new checkout attempt.
  const pending = await prisma.payment.findFirst({
    where: { tripId, userId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });

  const payment = pending
    ? await prisma.payment.update({
        where: { id: pending.id },
        data: {
          reference,
          passengerCount,
          rideFare,
          platformFee,
          totalAmount,
          currency: 'NGN',
          provider: 'FLUTTERWAVE',
          providerReference: null,
          failureReason: null,
        },
      })
    : await prisma.payment.create({
        data: {
          userId,
          tripId,
          reference,
          passengerCount,
          rideFare,
          platformFee,
          totalAmount,
          currency: 'NGN',
          status: 'PENDING',
          provider: 'FLUTTERWAVE',
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
      rideFare,
      platformFee,
      totalAmount,
      provider: 'FLUTTERWAVE',
      reference,
    },
  }).catch(() => {});

  const providerResult = await createFlutterwavePayment({
    provider: 'FLUTTERWAVE',
    email,
    amountInSmallestUnit: amountInKobo,
    reference,
    metadata: {
      tripId,
      userId,
      passengerCount: String(passengerCount),
      rideFare: String(rideFare),
      platformFee: String(platformFee),
      totalAmount: String(totalAmount),
    },
  });

  if (providerResult.error) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        failureReason: providerResult.error,
      },
    });
    return { success: false as const, error: providerResult.error, paymentId: payment.id };
  }

  if (providerResult.providerReference) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { providerReference: providerResult.providerReference },
    });
  }

  return {
    success: true as const,
    checkoutUrl: providerResult.checkoutUrl,
    providerReference: providerResult.providerReference ?? undefined,
    reference,
    paymentId: payment.id,
    amount: totalAmount,
    breakdown: { rideFare, platformFee, totalAmount },
  };
}

/**
 * Verify a CampusCab payment with Flutterwave.
 * Server-side authoritative check — never trusts frontend callbacks alone.
 */
export async function verifyPayment(reference: string) {
  // Payment records may have a providerReference from the checkout init, but
  // Flutterwave verification is done by tx_ref (our internal reference).
  const payment = await prisma.payment.findUnique({ where: { reference } });

  if (!payment) {
    return { success: false as const, error: 'Payment not found.' };
  }
  if (payment.status === 'SUCCESSFUL') {
    return { success: true as const, alreadyVerified: true as const };
  }

  const providerResult = await verifyFlutterwavePayment(
    payment.providerReference ?? reference
  );

  if (providerResult.error) {
    return { success: false as const, error: providerResult.error };
  }

  if (providerResult.status === 'successful') {
    // Validate amount and currency before confirming — never trust the
    // provider response alone against our server-calculated fare.
    const currencyOk = !providerResult.currency || providerResult.currency === 'NGN';
    const amountOk =
      providerResult.amount == null ||
      Math.abs(providerResult.amount - payment.totalAmount) <= 0.01;

    if (!currencyOk || !amountOk) {
      const reason = !currencyOk
        ? `Currency mismatch: expected NGN, got ${providerResult.currency}`
        : `Amount mismatch: expected ${payment.totalAmount} NGN, got ${providerResult.amount}`;
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failureReason: reason },
      });
      logAudit({
        userId: payment.userId,
        action: 'payment.amount_mismatch',
        entity: 'Payment',
        entityId: payment.id,
        details: {
          expected: payment.totalAmount,
          received: providerResult.amount,
          currency: providerResult.currency,
          source: 'verify',
        },
      }).catch(() => {});
      return { success: false as const, error: reason };
    }

    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCESSFUL',
          providerReference: providerResult.providerReference ?? payment.providerReference,
          paidAt: new Date(providerResult.paidAt ?? Date.now()),
        },
      }),
      prisma.trip.update({
        where: { id: payment.tripId },
        data: {
          appCharge: payment.platformFee,
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
        platformFee: payment.platformFee,
        providerReference: providerResult.providerReference,
      },
    }).catch(() => {});

    return { success: true as const, paymentId: payment.id };
  }

  if (providerResult.status === 'failed') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        failureReason: providerResult.failureReason ?? 'Payment was not successful',
      },
    });
    return { success: false as const, error: providerResult.failureReason ?? 'Payment was not successful' };
  }

  return { success: false as const, error: 'Payment is still pending', pending: true as const };
}

/**
 * Handle an incoming Flutterwave webhook.
 * Idempotent and tamper-protected. Returns true only if the event was processed.
 */
export async function handleWebhookProvider(event: WebhookEvent): Promise<boolean> {
  // Flutterwave sends the secret hash in the verif-hash header. Reject anything
  // without a valid signature before parsing or acting on the payload.
  if (!verifyFlutterwaveSignature(event.rawBody, event.signatureHeader ?? null)) {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = JSON.parse(event.rawBody) as any;
  // Flutterwave nests tx_ref under `data`; keep top-level fallbacks for
  // compatibility with other event shapes.
  const eventData = (payload.data ?? {}) as Record<string, unknown>;
  const providerReference = String(
    eventData.tx_ref ??
      payload.tx_ref ??
      payload.outOrderId ??
      payload.order_no ??
      payload.orderId ??
      payload.reference ??
      ''
  );

  const payment = await prisma.payment.findFirst({
    where: { OR: [{ providerReference }, { reference: providerReference }] },
    orderBy: { createdAt: 'desc' },
  });

  // Unknown reference — acknowledge so Flutterwave stops retrying, but do not
  // act on it.
  if (!payment) {
    return true;
  }

  // Idempotent: already confirmed, nothing to do.
  if (payment.status === 'SUCCESSFUL') {
    return true;
  }

  const normalized = normalizeFlutterwaveEvent(providerReference, payload);

  // Webhook events are never trusted on their own. Re-verify against Flutterwave
  // before updating state.
  if (normalized.status === 'successful') {
    const verification = await verifyFlutterwavePayment(providerReference);

    if (verification.status !== 'successful' || verification.error) {
      // Premature/stale event; let the callback and future retries handle it.
      return true;
    }

    // Tamper protection: the verified amount/currency must match our
    // server-calculated fare, and our stored record must be NGN. We never
    // trust amounts coming from the webhook payload alone.
    const currencyOk =
      payment.currency === 'NGN' &&
      (!verification.currency || verification.currency === 'NGN');
    const amountOk =
      verification.amount == null ||
      Math.abs(verification.amount - payment.totalAmount) <= 0.01;
    if (!currencyOk || !amountOk) {
      logAudit({
        userId: payment.userId,
        action: 'payment.amount_mismatch',
        entity: 'Payment',
        entityId: payment.id,
        details: {
          expected: payment.totalAmount,
          received: verification.amount,
          currency: verification.currency,
          source: 'webhook',
        },
      }).catch(() => {});
      return true;
    }

    const updated = await prisma.payment.updateMany({
      where: { id: payment.id, status: { not: 'SUCCESSFUL' } },
      data: {
        status: 'SUCCESSFUL',
        providerReference: verification.providerReference ?? payment.providerReference,
        paidAt: new Date(verification.paidAt ?? Date.now()),
      },
    });

    if (updated.count > 0) {
      await prisma.trip.update({
        where: { id: payment.tripId },
        data: {
          appCharge: payment.platformFee,
          driverEarnings: payment.rideFare,
        },
      });

      logAudit({
        userId: payment.userId,
        action: 'payment.successful',
        entity: 'Payment',
        entityId: payment.id,
        details: {
          tripId: payment.tripId,
          totalAmount: payment.totalAmount,
          rideFare: payment.rideFare,
          platformFee: payment.platformFee,
          providerReference: verification.providerReference,
          source: 'webhook',
        },
      }).catch(() => {});
    }

    return true;
  }

  if (normalized.status === 'failed') {
    await prisma.payment.updateMany({
      where: { id: payment.id, status: { not: 'SUCCESSFUL' } },
      data: {
        status: 'FAILED',
        failureReason: normalized.failureReason ?? 'Payment not successful',
      },
    }).catch(() => {});
    return true;
  }

  // pending/other events: acknowledge so Flutterwave stops retrying.
  return true;
}

/**
 * Initiate a driver payout for a completed trip.
 *
 * Payout requires a matching Payment and trip driver. If the driver has a
 * Flutterwave bank account on file, it is preferred. Payouts are not automatic:
 * they require FLUTTERWAVE_TRANSFERS_ENABLED=1 on the merchant dashboard.
 */
export async function createPayoutForTrip({
  tripId,
  paymentId,
}: {
  tripId: string;
  paymentId: string;
}): Promise<PayoutResult & { payoutId?: string; provider: Provider }> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { driver: { include: { user: true } } },
  });

  if (!trip?.driver) {
    return { error: 'Trip has no assigned driver', provider: 'FLUTTERWAVE' };
  }

  const driverDbId = trip.driverId;
  if (!driverDbId) {
    return { error: 'Trip has no assigned driver', provider: 'FLUTTERWAVE' };
  }

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) {
    return { error: 'Payment not found', provider: 'FLUTTERWAVE' };
  }

  // Prevent duplicate transfers: only allow a retry when the previous payout
  // attempt failed (or was reversed).
  const existingPayout = await prisma.payout.findFirst({
    where: { tripId, status: { in: ['PENDING', 'PROCESSING', 'SUCCESS'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (existingPayout) {
    return {
      error: 'A payout for this trip already exists and has not failed.',
      provider: 'FLUTTERWAVE',
      payoutId: existingPayout.id,
    };
  }

  const driverAccount = await prisma.driverPaymentAccount.findUnique({
    where: { driverId: driverDbId },
  });

  const recipient: PayoutRecipient = {
    name: (trip.driver.user?.name ?? 'Driver').toString(),
    phone: trip.driver.user?.phone ?? undefined,
    bankCode: driverAccount?.bankCode ?? undefined,
    bankName: driverAccount?.bankName ?? undefined,
    accountNumber: driverAccount?.accountNumber ?? undefined,
    accountName: driverAccount?.accountName ?? undefined,
  };

  const payoutReference = `ccab-payout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const payout = await prisma.payout.create({
    data: {
      tripId,
      driverId: driverDbId,
      paymentId,
      provider: 'FLUTTERWAVE',
      amount: payment.rideFare,
      status: 'PENDING',
    },
  });

  const providerResult = await createFlutterwavePayout({
    provider: 'FLUTTERWAVE',
    driverId: driverDbId,
    amountInSmallestUnit: toProviderAmount(payment.rideFare),
    recipient,
    reference: payoutReference,
  });

  if (providerResult.error) {
    await prisma.payout.update({
      where: { id: payout.id },
      data: {
        status: 'FAILED',
        failureReason: providerResult.error,
      },
    });
    return { error: providerResult.error, payoutId: payout.id, provider: 'FLUTTERWAVE' };
  }

  const providerRef = providerResult.providerReference ?? payoutReference;
  const payoutStatus: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' =
    providerResult.status === 'success'
      ? 'SUCCESS'
      : providerResult.status === 'failed'
        ? 'FAILED'
        : providerResult.status === 'processing' || providerResult.status === 'pending'
          ? 'PROCESSING'
          : 'PROCESSING';

  await prisma.payout.update({
    where: { id: payout.id },
    data: {
      providerReference: providerRef,
      status: payoutStatus,
      initiatedAt: new Date(),
    },
  });

  return { providerReference: providerRef, status: payoutStatus, payoutId: payout.id, provider: 'FLUTTERWAVE' };
}
