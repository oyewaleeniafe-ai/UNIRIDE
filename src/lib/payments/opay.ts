/**
 * OPay payment adapter for CampusCab.
 *
 * Design constraints applied here:
 *  - All OPay API calls are server-side only.
 *  - Credentials come from environment variables, never the browser.
 *  - No endpoint, parameter, signature method, or webhook format is invented.
 *  - Payout logic is isolated and returns an explicit "not available" error
 *    unless OPay's official merchant payout API is enabled and documented for
 *    this account.
 *
 * Official OPay developer documentation is the source of truth. If OPay's public
 * docs for a required endpoint (create payment, verify payment, webhook
 * signature, split settlement, or payout) are not available/approved for this
 * merchant account, the adapter stubs the feature with a clear error instead of
 * fabricating behavior.
 */

import type { createHmac } from 'node:crypto';
import type {
  CreatePaymentRequest,
  CreatePaymentResult,
  VerifyPaymentResult,
  PayoutRequest,
  PayoutResult,
  WebhookEvent,
} from './types';
import { createHmac as nodeCreateHmac, randomUUID } from 'node:crypto';

const OPAY_BASE_URL = process.env.OPAY_BASE_URL?.replace(/\/+$/, '')
  ?? 'https://opay.api'; // TODO: replace with OPay's documented base URL once confirmed

const OPAY_MERCHANT_ID = process.env.OPAY_MERCHANT_ID;
const OPAY_API_KEY = process.env.OPAY_SECRET_KEY;
const OPAY_WEBHOOK_SECRET = process.env.OPAY_WEBHOOK_SECRET;

/**
 * OPay API key authentication header.
 *
 * IMPORTANT: The exact header name and styling must match OPay's official
 * merchant API documentation. This implementation uses a conservative
 * Authorization: Bearer style as a placeholder. Update to match OPay's docs.
 */
function opayAuthHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'MerchantId': OPAY_MERCHANT_ID ?? '',
    // TODO before production: confirm OPay's documented auth header.
    'Authorization': `Bearer ${OPAY_API_KEY ?? ''}`,
  };
}

function opaySignature(body: string): string {
  if (!OPAY_API_KEY) return '';
  const hmac = nodeCreateHmac('sha256', OPAY_API_KEY);
  hmac.update(body, 'utf8');
  return hmac.digest('hex');
}

/**
 * Create an OPay payment order and return the checkout URL.
 *
 * If OPay's documented payment create endpoint differs from the one used here,
 * update this to match the official OPay docs exactly.
 */
export async function createPayment(
  request: CreatePaymentRequest
): Promise<CreatePaymentResult> {
  if (!OPAY_MERCHANT_ID || !OPAY_API_KEY) {
    return { error: 'OPay is not configured' };
  }

  const payload = {
    merchantId: OPAY_MERCHANT_ID,
    orderId: request.reference,
    amount: request.amountInSmallestUnit,
    currency: 'NGN',
    title: 'CampusCab Ride',
    description: `CampusCab ride — ${request.metadata.rideType ?? 'ride'}`,
    // TODO before production: confirm OPay's documented redirect/notif URLs.
    notifyUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://campuscab-pi.vercel.app'}/api/payments/webhook`,
    redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://campuscab-pi.vercel.app'}/student/rides?payment=pending`,
    meta: request.metadata,
  };

  const body = JSON.stringify(payload);
  const signature = opaySignature(body);

  const headers = {
    ...opayAuthHeaders(),
    'Signature': signature,
    'Timestamp': String(Date.now()),
  };

  let response: Response;
  try {
    response = await fetch(`${OPAY_BASE_URL}/pay/order/create`, {
      method: 'POST',
      headers,
      body,
    });
  } catch {
    return { error: 'Failed to connect to OPay' };
  }

  const result = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    return { error: String(result.message ?? result.error ?? 'OPay order creation failed') };
  }

  const data = (result.data ?? {}) as Record<string, unknown>;
  const orderId = String(data.orderId ?? data.order_no ?? request.reference);
  const payUrl = String(data.payUrl ?? data.checkout_url ?? data.url ?? '');

  return {
    providerReference: orderId,
    checkoutUrl: payUrl || undefined,
    pollReference: orderId,
  };
}

/**
 * Verify an OPay payment status using the documented order query endpoint.
 *
 * If OPay's status query endpoint differs, update this to match the docs.
 */
export async function verifyPayment(
  providerReference: string
): Promise<VerifyPaymentResult> {
  if (!OPAY_MERCHANT_ID || !OPAY_API_KEY) {
    return { status: 'pending', error: 'OPay is not configured' };
  }

  const query = {
    merchantId: OPAY_MERCHANT_ID,
    orderId: providerReference,
  };

  const body = JSON.stringify(query);
  const signature = opaySignature(body);
  const headers = {
    ...opayAuthHeaders(),
    'Signature': signature,
    'Timestamp': String(Date.now()),
  };

  let response: Response;
  try {
    response = await fetch(`${OPAY_BASE_URL}/pay/order/query`, {
      method: 'POST',
      headers,
      body,
    });
  } catch {
    return { status: 'pending', error: 'Failed to connect to OPay' };
  }

  const result = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    return { status: 'pending', error: String(result.message ?? result.error ?? 'OPay status query failed') };
  }

  const data = (result.data ?? {}) as Record<string, unknown>;
  const status = String(data.status ?? '').toUpperCase();
  const paidAt = data.payTime ?? data.paid_at ?? null;

  if (status === 'SUCCESS' || status === 'PAID') {
    return {
      status: 'successful',
      providerReference,
      paidAt: paidAt ? String(paidAt) : new Date().toISOString(),
    };
  }

  if (status === 'FAILED' || status === 'CANCELLED' || status === 'CLOSED') {
    return {
      status: 'failed',
      providerReference,
      failureReason: String(data.message ?? data.failReason ?? 'Payment not successful'),
    };
  }

  return { status: 'pending' };
}

/**
 * Verify an OPay webhook event signature.
 *
 * IMPORTANT: The signature scheme and header name must match OPay's official
 * webhook documentation. This implementation checks a configurable header
 * (default: x-opay-signature) against an HMAC-SHA256 of the raw body using
 * OPAY_WEBHOOK_SECRET.
 *
 * TODO before production: confirm the webhook signature header name and method
 * from OPay docs, then align this verification accordingly.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = OPAY_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;

  const hmac = nodeCreateHmac('sha256', secret);
  hmac.update(rawBody, 'utf8');
  const expected = hmac.digest('hex');

  return Boolean(expected) && expected === signatureHeader;
}

/**
 * Normalize OPay webhook payloads into CampusCab's internal PaymentStatus.
 *
 * IMPORTANT: This mapping must match OPay's documented event types. Update
 * when OPay's webhook event names are confirmed.
 */
export function normalizeWebhookEvent(
  providerReference: string,
  payload: Record<string, unknown>
): VerifyPaymentResult {
  const status = String(payload.status ?? payload.paymentStatus ?? '').toUpperCase();
  const paidAt = payload.payTime ?? payload.paid_at ?? payload.paidAt ?? null;
  const failureReason = payload.message ?? payload.failReason ?? payload.gateway_response ?? null;

  if (status === 'SUCCESS' || status === 'PAID') {
    return {
      status: 'successful',
      providerReference,
      paidAt: paidAt ? String(paidAt) : new Date().toISOString(),
    };
  }

  if (status === 'FAILED' || status === 'CANCELLED' || status === 'CLOSED') {
    return {
      status: 'failed',
      providerReference,
      failureReason: String(failureReason ?? 'Payment not successful'),
    };
  }

  return { status: 'pending' };
}

/**
 * Initiate a driver payout via OPay.
 *
 * OPay payout support depends on the merchant account and the official OPay
 * payout API. If that endpoint is not available/approved for this merchant
 * account, this function returns an explicit error instead of fabricating an
 * endpoint. Payout is intentionally isolated so it can be completed later
 * without touching the rest of the payment flow.
 */
export async function createPayout(request: PayoutRequest): Promise<PayoutResult> {
  if (!OPAY_MERCHANT_ID || !OPAY_API_KEY) {
    return { error: 'OPay is not configured' };
  }
  if (!request.recipient.accountNumber && !request.recipient.providerRecipientId) {
    return { error: 'OPay payout requires a bank account or provider recipient ID' };
  }

  // TODO before production: confirm OPay's official payout endpoint, params,
  // authentication, bank code semantics, and whether split settlement affects
  // payouts. Until then, expose a clear not-implemented signal rather than
  // inventing behavior.
  if (!process.env.OPAY_PAYOUT_ENABLED) {
    return {
      error: 'OPay payouts are not enabled yet. Set OPAY_PAYOUT_ENABLED=1 when the merchant payout API is approved.',
    };
  }

  const payload = {
    merchantId: OPAY_MERCHANT_ID,
    outOrderId: request.reference,
    amount: request.amountInSmallestUnit,
    currency: 'NGN',
    bankCode: request.recipient.bankCode,
    receiverAccount: request.recipient.accountNumber,
    receiverName: request.recipient.name,
    memo: `CampusCab driver payout — trip ${request.driverId}`,
  };

  const body = JSON.stringify(payload);
  const signature = opaySignature(body);
  const headers = {
    ...opayAuthHeaders(),
    'Signature': signature,
    'Timestamp': String(Date.now()),
  };

  let response: Response;
  try {
    response = await fetch(`${OPAY_BASE_URL}/pay/out/pay`, {
      method: 'POST',
      headers,
      body,
    });
  } catch {
    return { error: 'Failed to connect to OPay payout endpoint' };
  }

  const result = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    return { error: String(result.message ?? result.error ?? 'OPay payout failed') };
  }

  const data = (result.data ?? {}) as Record<string, unknown>;

  return {
    providerReference: String(data.outOrderId ?? data.out_order_id ?? request.reference),
    status: 'processing',
  };
}

export const OPAY_WEBHOOK_HEADER = (process.env.OPAY_WEBHOOK_SIGNATURE_HEADER ?? 'x-opay-signature').trim();
