/**
 * Paystack server-side utility.
 *
 * This module handles payment initialization and verification with Paystack.
 * ALL monetary calculations happen server-side — the frontend never controls the amount.
 */

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// ─── Fare Constants (server-side source of truth) ─────

export const FARE_PER_PASSENGER = 200; // ₦200 per passenger
export const APP_CHARGE = 30; // ₦30 per booking (once)

/**
 * Calculate the total fare server-side.
 * NEVER trust frontend-supplied amounts.
 */
export function calculateFare(passengerCount: number): {
  rideFare: number;
  appCharge: number;
  totalAmount: number;
} {
  const rideFare = FARE_PER_PASSENGER * passengerCount;
  const appCharge = APP_CHARGE;
  const totalAmount = rideFare + appCharge;

  return { rideFare, appCharge, totalAmount };
}

// ─── Types ────────────────────────────────────────────

export interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

export interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    domain: string;
    status: string;
    reference: string;
    amount: number;
    message: string | null;
    gateway_response: string;
    paid_at: string;
    created_at: string;
    channel: string;
    currency: string;
    ip_address: string;
    metadata: Record<string, unknown>;
    fees: number;
    authorization: Record<string, unknown>;
    customer: Record<string, unknown>;
  };
}

// ─── Initialize Transaction ───────────────────────────

/**
 * Initialize a Paystack transaction.
 *
 * @param email - The payer's email address
 * @param amountInKobo - Amount in kobo (e.g., ₦230 = 23000 kobo)
 * @param reference - Unique reference for this transaction
 * @param metadata - Additional data to attach to the transaction
 * @returns Paystack response with authorization URL
 */
export async function initializeTransaction(
  email: string,
  amountInKobo: number,
  reference: string,
  metadata?: Record<string, unknown>
): Promise<PaystackInitializeResponse> {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error('PAYSTACK_SECRET_KEY is not configured');
  }

  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      amount: amountInKobo,
      reference,
      currency: 'NGN',
      metadata: metadata || {},
      callback_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://campuscab-pi.vercel.app'}/api/payments/verify`,
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || 'Failed to initialize payment');
  }

  return result;
}

// ─── Verify Transaction ───────────────────────────────

/**
 * Verify a Paystack transaction server-side.
 * This is the authoritative check — never trust the frontend callback.
 *
 * @param reference - The transaction reference to verify
 * @returns Paystack verification response
 */
export async function verifyTransaction(
  reference: string
): Promise<PaystackVerifyResponse> {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error('PAYSTACK_SECRET_KEY is not configured');
  }

  const response = await fetch(
    `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || 'Failed to verify payment');
  }

  return result;
}

// ─── Reference Generation ─────────────────────────────

/**
 * Generate a unique payment reference.
 * Format: ccab-{uuid}-{timestamp}
 */
export function generatePaymentReference(): string {
  const uuid = crypto.randomUUID().split('-')[0];
  const timestamp = Date.now().toString(36);
  return `ccab-${uuid}-${timestamp}`;
}
