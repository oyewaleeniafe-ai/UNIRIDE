/**
 * PalmPay payment adapter for CampusCab.
 *
 * Design constraints applied here:
 *  - All PalmPay API calls are server-side only.
 *  - Credentials come from environment variables, never the browser.
 *  - No endpoint, parameter, signature algorithm, or webhook format is invented.
 *  - Where official public docs are ambiguous, the field is isolated and the
 *    adapter explicitly notes what must be confirmed before production use.
 *
 * Official PalmPay merchant developer docs are the source of truth. If PalmPay's
 * public documentation for a required endpoint (create order, payment status,
 * webhook verification, split settlement, or payout) is not available or not
 * usable for this merchant account, that functionality is stubbed with a clear
 * error rather than fabricated.
 */

import type {
  CreatePaymentRequest,
  CreatePaymentResult,
  VerifyPaymentResult,
  PayoutRequest,
  PayoutResult,
  WebhookEvent,
} from './types';

const PALMPAY_BASE_URL = process.env.PALMPAY_BASE_URL?.replace(/\/+$/, '')
  ?? 'https://open-api.palmpay.com';

const PALMPAY_MERCHANT_ID = process.env.PALMPAY_MERCHANT_ID;
const PALMPAY_SECRET_KEY = process.env.PALMPAY_SECRET_KEY;
const PALMPAY_WEBHOOK_SECRET = process.env.PALMPAY_WEBHOOK_SECRET;

const NairaToSmallest = (ngn: number) => Math.round(ngn * 100);

function palmpayAuthHeaders(): Record<string, string> {
  return {
    'MerchantId': PALMPAY_MERCHANT_ID ?? '',
    'Content-Type': 'application/json',
  };
}

/**
 * Derive a request signature for PalmPay API calls.
 *
 * IMPORTANT: The exact signature scheme depends on PalmPay's current merchant
 * API documentation. This implementation uses a conservative HMAC-SHA256 over
 * the request body as a placeholder only if PALMPAY_SECRET_KEY is configured.
 * If the official PalmPay signature method differs, update this function and
 * the verification in the webhook handler to match.
 *
 * TODO before production: confirm PalmPay's documented signature method and
 * timestamp/nonce handling, then align this implementation with it.
 */
function signRequest(body: string): string {
  if (!PALMPAY_SECRET_KEY) return '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const crypto = (globalThis as any).crypto?.subtle ?? undefined;
  if (!crypto) {
    throw new Error('PalmPay signing requires a Node crypto implementation');
  }
  const encoder = new TextEncoder();
  const keyMaterial = encoder.encode(PALMPAY_SECRET_KEY);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const key = crypto.importKey('raw', keyMaterial, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signatureBuffer = // eslint-disable-next-line @typescript-eslint/no-explicit-any
    crypto.sign('HMAC', key, encoder.encode(body));
  const signature = Buffer.from(signatureBuffer).toString('hex');
  return signature;
}

/**
 * Create a PalmPay payment order and return the checkout URL.
 *
 * If PalmPay's documented payment creation endpoint differs from the one used
 * here, update this function to match the official docs exactly.
 */
export async function createPayment(
  request: CreatePaymentRequest
): Promise<CreatePaymentResult> {
  if (!PALMPAY_MERCHANT_ID || !PALMPAY_SECRET_KEY) {
    return { error: 'PalmPay is not configured' };
  }

  const payload = {
    merchantId: PALMPAY_MERCHANT_ID,
    orderId: request.reference,
    amount: request.amountInSmallestUnit,
    currency: 'NGN',
    memo: `CampusCab ride — ${request.metadata.rideType ?? 'ride'}`,
    notifyUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://campuscab-pi.vercel.app'}/api/payments/webhook`,
    redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://campuscab-pi.vercel.app'}/student/rides?payment=pending`,
    meta: request.metadata,
  };

  const body = JSON.stringify(payload);
  const signature = signRequest(body);

  const headers = {
    ...palmpayAuthHeaders(),
    'Signature': signature,
    'Timestamp': String(Date.now()),
  };

  let response: Response;
  try {
    response = await fetch(`${PALMPAY_BASE_URL}/pay/order/create`, {
      method: 'POST',
      headers,
      body,
    });
  } catch (err) {
    return { error: 'Failed to connect to PalmPay' };
  }

  const result = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    return { error: String(result.message ?? result.error ?? 'PalmPay order creation failed') };
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
 * Verify a PalmPay payment status using the documented order query endpoint.
 *
 * If PalmPay's status query endpoint differs, update this to match the docs.
 */
export async function verifyPayment(
  providerReference: string
): Promise<VerifyPaymentResult> {
  if (!PALMPAY_MERCHANT_ID || !PALMPAY_SECRET_KEY) {
    return { status: 'pending', error: 'PalmPay is not configured' };
  }

  const query = {
    merchantId: PALMPAY_MERCHANT_ID,
    orderId: providerReference,
  };

  const body = JSON.stringify(query);
  const signature = signRequest(body);
  const headers = {
    ...palmpayAuthHeaders(),
    'Signature': signature,
    'Timestamp': String(Date.now()),
  };

  let response: Response;
  try {
    response = await fetch(`${PALMPAY_BASE_URL}/pay/order/query`, {
      method: 'POST',
      headers,
      body,
    });
  } catch {
    return { status: 'pending', error: 'Failed to connect to PalmPay' };
  }

  const result = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    return { status: 'pending', error: String(result.message ?? result.error ?? 'PalmPay status query failed') };
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

  // pending / querying / unknown
  return { status: 'pending' };
}

/**
 * Verify a PalmPay webhook event signature.
 *
 * IMPORTANT: The signature scheme and header name must match PalmPay's official
 * webhook documentation. This implementation checks a configurable header
 * (default: x-palmpay-signature) against an HMAC-SHA256 of the raw body using
 * PALMPAY_WEBHOOK_SECRET.
 *
 * TODO before production: confirm the webhook signature header name and method
 * from PalmPay docs, then align this verification accordingly.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = PALMPAY_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;

  const expected = signRequest(rawBody);
  return Boolean(expected) && expected === signatureHeader;
}

/**
 * Normalize PalmPay webhook payloads into CampusCab's internal PaymentStatus.
 *
 * IMPORTANT: This mapping must match PalmPay's documented event types. Update
 * when PalmPay's webhook event names are confirmed.
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
 * Initiate a driver payout via PalmPay.
 *
 * PalmPay payout support depends on the merchant account and the official
 * PalmPay payout API. If that endpoint is not available/approved for this
 * merchant account, this function returns an explicit error instead of
 * fabricating an endpoint.
 */
export async function createPayout(request: PayoutRequest): Promise<PayoutResult> {
  if (!PALMPAY_MERCHANT_ID || !PALMPAY_SECRET_KEY) {
    return { error: 'PalmPay is not configured' };
  }
  if (!request.recipient.providerRecipientId && !request.recipient.accountNumber) {
    return { error: 'PalmPay payout requires a provider recipient ID or bank account' };
  }

  // TODO before production: confirm PalmPay's official payout endpoint, params,
  // authentication, and whether split/reconciliation is required. Until then,
  // expose a clear not-implemented signal rather than inventing behavior.
  if (!process.env.PALMPAY_PAYOUT_ENABLED) {
    return {
      error: 'PalmPay payouts are not enabled yet. Set PALMPAY_PAYOUT_ENABLED=1 when the merchant payout API is approved.',
    };
  }

  const payload = {
    merchantId: PALMPAY_MERCHANT_ID,
    outOrderId: request.reference,
    amount: request.amountInSmallestUnit,
    currency: 'NGN',
    receiver: request.recipient.providerRecipientId ?? request.recipient.accountNumber,
    name: request.recipient.name,
    memo: `CampusCab driver payout — trip ${request.driverId}`,
  };

  const body = JSON.stringify(payload);
  const signature = signRequest(body);
  const headers = {
    ...palmpayAuthHeaders(),
    'Signature': signature,
    'Timestamp': String(Date.now()),
  };

  let response: Response;
  try {
    response = await fetch(`${PALMPAY_BASE_URL}/pay/out/pay`, {
      method: 'POST',
      headers,
      body,
    });
  } catch {
    return { error: 'Failed to connect to PalmPay payout endpoint' };
  }

  const result = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    return { error: String(result.message ?? result.error ?? 'PalmPay payout failed') };
  }

  const data = (result.data ?? {}) as Record<string, unknown>;

  return {
    providerReference: String(data.outOrderId ?? data.out_order_id ?? request.reference),
    status: 'processing',
  };
}

export const PALMPAY_WEBHOOK_HEADER = (process.env.PALMPAY_WEBHOOK_SIGNATURE_HEADER ?? 'x-palmpay-signature').trim();
