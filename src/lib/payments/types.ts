/**
 * Shared payment provider types for CampusCab.
 *
 * CampusCab uses Flutterwave as the only payment provider. The provider enum
 * is kept here so the rest of the app can stay decoupled from provider-specific
 * details, but only FLUTTERWAVE is valid.
 */

export type Provider = 'FLUTTERWAVE';

export type ProviderReference = string;

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
  /** Amount as reported by Flutterwave, in NGN (major units). */
  amount?: number;
  /** Currency as reported by Flutterwave (e.g. "NGN"). */
  currency?: string;
}

export interface PayoutRecipient {
  name: string;
  phone?: string;
  /** Nigerian bank code where applicable. */
  bankCode?: string;
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
}

export interface PayoutRequest {
  provider: Provider;
  driverId: string;
  amountInSmallestUnit: number;
  recipient: PayoutRecipient;
  reference: string;
}

export interface PayoutResult {
  providerReference?: string;
  status?: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
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

export const FLUTTERWAVE_WEBHOOK_HEADER = 'verif-hash';
