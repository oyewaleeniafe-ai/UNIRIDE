/**
 * Shared payment provider types for CampusCab.
 *
 * Keeps provider-specific modules decoupled from the rest of the app.
 */

export type Provider = 'PALMPAY' | 'OPAY';

export type PaymentState =
  | { status: 'pending' }
  | { status: 'successful'; paidAt: string; providerReference: string }
  | { status: 'failed'; reason: string };

export interface CreatePaymentRequest {
  provider: Provider;
  email: string;
  amountInSmallestUnit: number;
  reference: string;
  metadata: Record<string, string | number>;
}

export interface CreatePaymentResult {
  checkoutUrl?: string;
  providerReference?: string;
  pollReference?: string;
  error?: string;
}

export interface VerifyPaymentResult {
  status: 'successful' | 'failed' | 'pending';
  providerReference?: string;
  paidAt?: string;
  failureReason?: string;
  error?: string;
}

export interface PayoutRequest {
  provider: Provider;
  driverId: string;
  amountInSmallestUnit: number;
  recipient: PayoutRecipient;
  reference: string;
}

export interface PayoutRecipient {
  /** Bank code where applicable (e.g. Nigerian bank code for OPay). */
  bankCode?: string;
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
  /** Provider-specific recipient identifier (e.g. PalmPay PID). */
  providerRecipientId?: string;
  name: string;
  phone?: string;
}

export interface PayoutResult {
  providerReference?: string;
  status?: 'pending' | 'processing' | 'success' | 'failed';
  error?: string;
}

export interface WebhookEvent {
  provider: Provider;
  rawBody: string;
  signatureHeader?: string;
}

export function maskAccountNumber(value: string | undefined): string {
  if (!value || value.length < 4) return '••••';
  const last4 = value.slice(-4);
  const masked = '•'.repeat(Math.max(0, value.length - 4));
  return `${masked}${last4}`;
}

export const PALMPAY_WEBHOOK_HEADER = (process.env.PALMPAY_WEBHOOK_SIGNATURE_HEADER ?? 'x-palmpay-signature').trim();
export const OPAY_WEBHOOK_HEADER = (process.env.OPAY_WEBHOOK_SIGNATURE_HEADER ?? 'x-opay-signature').trim();
