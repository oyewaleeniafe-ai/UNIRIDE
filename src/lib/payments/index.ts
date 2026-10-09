/**
 * CampusCab payment service facade.
 *
 * This is the only module most of the app should import for provider-backed
 * payment operations. It delegates to PalmPay or OPay internally and keeps
 * provider-specific details out of the rest of the codebase.
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import {
  createPayment as createPalmPayPayment,
  verifyPayment as verifyPalmPayPayment,
  verifyWebhookSignature as verifyPalmPaySignature,
  normalizeWebhookEvent as normalizePalmPayEvent,
  createPayout as createPalmPayPayout,
} from './palmpay';
import {
  createPayment as createOpayPayment,
  verifyPayment as verifyOpayPayment,
  verifyWebhookSignature as verifyOpaySignature,
  normalizeWebhookEvent as normalizeOpayEvent,
  createPayout as createOpayPayout,
} from './opay';
import type {
  Provider,
  PayoutRecipient,
  PayoutResult,
  WebhookEvent,
} from './types';

export type { Provider } from './types';
export {
  maskAccountNumber,
  PALMPAY_WEBHOOK_HEADER,
  OPAY_WEBHOOK_HEADER,
} from './types';

function providerModule(provider: Provider) {
  if (provider === 'PALMPAY') {
    return {
      createPayment: createPalmPayPayment,
      verifyPayment: verifyPalmPayPayment,
      verifyWebhookSignature: verifyPalmPaySignature,
      normalizeWebhookEvent: normalizePalmPayEvent,
      createPayout: createPalmPayPayout,
    };
  }
  return {
    createPayment: createOpayPayment,
    verifyPayment: verifyOpayPayment,
    verifyWebhookSignature: verifyOpaySignature,
    normalizeWebhookEvent: normalizeOpayEvent,
    createPayout: createOpayPayout,
  };
}

/**
 * Build the amount in the provider's smallest currency unit (kobo).
 * CampusCab amounts are stored in NGN; providers expect integer kobo.
 */
export function toProviderAmount(naira: number): number {
  return Math.round(naira * 100);
}

/**
 * Create a CampusCab payment via the selected provider.
 *
 * This also persists a Payment record so the webhook and verify flows can be
 * idempotent and tamper-protected.
 */
export async function createPayment({
  tripId,
  userId,
  provider,
  passengerCount,
  rideFare,
  platformFee,
  totalAmount,
  email,
}: {
  tripId: string;
  userId: string;
  provider: Provider;
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
  const amountInSmallestUnit = toProviderAmount(totalAmount);

  const payment = await prisma.payment.create({
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
      provider,
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
      provider,
      reference,
    },
  }).catch(() => {});

  const providerResult = await providerModule(provider).createPayment({
    provider,
    email,
    amountInSmallestUnit,
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
 * Verify a CampusCab payment with the selected provider.
 * Server-side authoritative check — never trusts frontend callbacks alone.
 */
export async function verifyPayment(reference: string, provider: Provider) {
  const payment = await prisma.payment.findUnique({ where: { reference } });

  if (!payment) {
    return { success: false as const, error: 'Payment not found.' };
  }
  if (payment.status === 'SUCCESSFUL') {
    return { success: true as const, alreadyVerified: true as const };
  }

  const providerResult = await providerModule(provider).verifyPayment(
    payment.providerReference ?? reference
  );

  if (providerResult.error) {
    return { success: false as const, error: providerResult.error };
  }

  if (providerResult.status === 'successful') {
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
 * Handle an incoming webhook from the selected provider.
 * Idempotent and tamper-protected. Returns true only if the event was processed.
 */
export async function handleWebhookProvider(provider: Provider, event: WebhookEvent): Promise<boolean> {
  const adapter = providerModule(provider);
  if (!adapter.verifyWebhookSignature(event.rawBody, event.signatureHeader ?? null)) {
    return false;
  }

  // Parse provider webhook payload generically.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = JSON.parse(event.rawBody) as any;
  const providerReference = String(payload.outOrderId ?? payload.order_no ?? payload.orderId ?? payload.reference ?? '');

  const payment = await prisma.payment.findFirst({
    where: { providerReference, provider },
    orderBy: { createdAt: 'desc' },
  });

  if (!payment) {
    return true; // acknowledge unknown events so provider stops retrying
  }

  if (payment.status === 'SUCCESSFUL') {
    return true; // idempotent
  }

  const normalized = adapter.normalizeWebhookEvent(providerReference, payload);

  if (normalized.status === 'successful') {
    const updated = await prisma.payment.updateMany({
      where: { id: payment.id, status: { not: 'SUCCESSFUL' } },
      data: {
        status: 'SUCCESSFUL',
        providerReference: normalized.providerReference ?? payment.providerReference,
        paidAt: new Date(normalized.paidAt ?? Date.now()),
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
          providerReference: normalized.providerReference,
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

  return true; // acknowledge pending/other events
}

/**
 * Initiate a driver payout for a completed trip.
 *
 * Payout requires a matching Payment and trip driver. If the driver has a
 * provider-specific recipient ID, it is preferred.
 */
export async function createPayoutForTrip({
  tripId,
  paymentId,
  provider,
}: {
  tripId: string;
  paymentId: string;
  provider: Provider;
}): Promise<PayoutResult & { payoutId?: string }> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { driver: { include: { user: true } } },
  });

  if (!trip?.driver) {
    return { error: 'Trip has no assigned driver' };
  }

  const driverDbId = trip.driverId;
  if (!driverDbId) {
    return { error: 'Trip has no assigned driver' };
  }

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) {
    return { error: 'Payment not found' };
  }

  const driverAccount = await prisma.driverPaymentAccount.findUnique({
    where: { driverId: driverDbId },
  });

  const recipient: PayoutRecipient = {
    name: (trip.driver.user?.name ?? 'Driver').toString(),
    phone: trip.driver.user?.phone ?? undefined,
    providerRecipientId: driverAccount?.providerRecipientId ?? undefined,
    bankCode: driverAccount?.bankCode ?? undefined,
    bankName: driverAccount?.bankName ?? undefined,
    accountNumber: driverAccount?.accountNumber ?? undefined,
    accountName: driverAccount?.accountName ?? undefined,
  };

  const payoutReference = `ccab-payout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const amountInSmallestUnit = toProviderAmount(payment.rideFare);

  const payout = await prisma.payout.create({
    data: {
      tripId,
      driverId: driverDbId,
      paymentId,
      provider,
      amount: payment.rideFare,
      status: 'PENDING',
    },
  });

  const providerResult = await providerModule(provider).createPayout({
    provider,
    driverId: driverDbId,
    amountInSmallestUnit,
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
    return { error: providerResult.error, payoutId: payout.id };
  }

  const providerRef = providerResult.providerReference ?? payoutReference;

  await prisma.payout.update({
    where: { id: payout.id },
    data: {
      providerReference: providerRef,
      status:
        providerResult.status === 'success'
          ? 'SUCCESS'
          : providerResult.status === 'failed'
            ? 'FAILED'
            : 'PROCESSING',
      initiatedAt: new Date(),
    },
  });

  return { providerReference: providerRef, status: 'processing', payoutId: payout.id };
}
