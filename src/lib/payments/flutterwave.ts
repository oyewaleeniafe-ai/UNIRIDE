import type { CreatePaymentRequest, CreatePaymentResult, VerifyPaymentResult } from './types'
import { createSandboxSession, getSandboxSession, sandboxEnabled } from './sandbox'

export const FLUTTERWAVE_BASE_URL = 'https://api.flutterwave.com/v3'
const SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY
const WEBHOOK_SECRET = process.env.FLUTTERWAVE_WEBHOOK_SECRET
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://campuscab-pi.vercel.app'

export function envError(label: string): string {
  return `FLUTTERWAVE is not configured: missing ${label}`
}

function authHeaders(): Record<string, string> {
  if (!SECRET_KEY) {
    throw new Error(envError('FLUTTERWAVE_SECRET_KEY'))
  }
  return {
    Authorization: `Bearer ${SECRET_KEY}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Create a Flutterwave Standard checkout session and return the hosted checkout URL.
 *
 * CampusCab's server-calculated amount is the source of truth; we pass it to
 * Flutterwave and never allow the frontend to choose the amount.
 */
export async function createPayment(
  request: CreatePaymentRequest
): Promise<CreatePaymentResult> {
  if (sandboxEnabled()) {
    const amount = request.amountInSmallestUnit / 100;
    createSandboxSession(request.reference, amount);
    return {
      providerReference: request.reference,
      checkoutUrl: `/api/payments/sandbox?reference=${encodeURIComponent(request.reference)}`,
      pollReference: request.reference,
    };
  }

  if (!SECRET_KEY) {
    return { error: envError('FLUTTERWAVE_SECRET_KEY') }
  }

  const payload = {
    tx_ref: request.reference,
    // Flutterwave expects amounts in major currency units (NGN), not kobo.
    amount: String(request.amountInSmallestUnit / 100),
    currency: 'NGN',
    redirect_url: `${APP_URL}/api/payments/verify?reference=${request.reference}`,
    customer: {
      email: request.email,
      // Flutterwave rejects the checkout ("One or more required parameters
      // missing") when the customer object carries no name, so always send
      // one — the email's local part is a safe fallback.
      name:
        (typeof request.metadata.name === 'string' && request.metadata.name.trim()) ||
        request.email.split('@')[0] ||
        'CampusCab Student',
      ...(typeof request.metadata.phone === 'string' && request.metadata.phone
        ? { phonenumber: request.metadata.phone }
        : {}),
    },
    customizations: {
      title: 'CampusCab Ride',
      description: `CampusCab ride — ${request.metadata.rideType ?? 'ride'}`,
      logo: 'https://cdn.flutterwave.com/img/logo.png',
    },
    payment_options: 'card, ussd',
    configuration: {
      session_duration: 10,
      max_retry_attempt: 5,
    },
    meta: request.metadata,
  }

  let response: Response
  try {
    response = await fetch(`${FLUTTERWAVE_BASE_URL}/payments`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    })
  } catch {
    return { error: 'Failed to connect to Flutterwave during payment initialization' }
  }

  const result = (await response.json()) as Record<string, unknown>

  if (!response.ok) {
    return { error: String(result.message ?? result.error ?? 'Flutterwave checkout creation failed') }
  }

  const data = result.data as Record<string, unknown> | null
  const link = data?.link
  if (typeof link !== 'string' || !link) {
    return { error: 'Flutterwave returned an invalid checkout link' }
  }

  const providerReference = request.reference

  return {
    providerReference,
    checkoutUrl: link,
    pollReference: providerReference,
  }
}

/**
 * Verify a Flutterwave transaction server-side using tx_ref.
 *
 * This is the authoritative confirmation — never trust the frontend redirect
 * or the webhook payload on its own.
 */
export async function verifyPayment(
  providerReference: string
): Promise<VerifyPaymentResult> {
  if (sandboxEnabled()) {
    const session = getSandboxSession(providerReference);
    if (!session) {
      return { status: 'pending', error: 'Sandbox checkout session not found.' };
    }
    if (!session.paid) {
      return { status: 'pending', error: 'Sandbox payment has not been completed.' };
    }
    return {
      status: 'successful',
      providerReference,
      amount: session.amount,
      currency: session.currency,
      paidAt: new Date().toISOString(),
    };
  }

  if (!SECRET_KEY) {
    return { status: 'pending', error: envError('FLUTTERWAVE_SECRET_KEY') }
  }

  let response: Response
  try {
    response = await fetch(
      `${FLUTTERWAVE_BASE_URL}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(providerReference)}`,
      {
        method: 'GET',
        headers: authHeaders(),
      }
    )
  } catch {
    return { status: 'pending', error: 'Failed to connect to Flutterwave during payment verification' }
  }

  const result = (await response.json()) as Record<string, unknown>

  if (!response.ok) {
    return { status: 'pending', error: String(result.message ?? result.error ?? 'Flutterwave verification failed') }
  }

  const data = result.data as Record<string, unknown> | null
  if (!data) {
    return { status: 'pending', error: 'Flutterwave returned an empty verification payload' }
  }

  const status = String(data.status ?? '').toLowerCase()
  const paidAt = (data.paid_at as string | undefined) ?? null
  const amount = Number(data.amount)
  const currency = String(data.currency ?? '').toUpperCase()

  if (status === 'successful') {
    return {
      status: 'successful',
      providerReference,
      paidAt: paidAt ?? new Date().toISOString(),
      ...(Number.isFinite(amount) ? { amount } : {}),
      ...(currency ? { currency } : {}),
    }
  }

  if (status === 'failed' || status === 'cancelled' || status === 'expired') {
    return {
      status: 'failed',
      providerReference,
      failureReason: String(data.message ?? data.error ?? data.gateway_response ?? 'Payment not successful'),
      ...(Number.isFinite(amount) ? { amount } : {}),
      ...(currency ? { currency } : {}),
    }
  }

  // pending / processing / abandoned
  return { status: 'pending' }
}

/**
 * Verify a Flutterwave webhook signature.
 *
 * Flutterwave sends the secret hash (configured in the dashboard) in the
 * `verif-hash` header. Compare it to FLUTTERWAVE_WEBHOOK_SECRET with a
 * constant-time comparison. If the header is missing or does not match,
 * reject the event.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!WEBHOOK_SECRET || !signatureHeader) {
    return false
  }

  const expected = WEBHOOK_SECRET.trim()
  const actual = signatureHeader.trim()

  // Constant-time comparison to avoid timing-based leakage.
  try {
    const expBuf = Buffer.from(expected, 'utf8')
    const actBuf = Buffer.from(actual, 'utf8')

    const cryptoAny = crypto as unknown as { timingSafeEqual?: (a: Buffer, b: Buffer) => boolean }
    if (typeof cryptoAny.timingSafeEqual === 'function') {
      return cryptoAny.timingSafeEqual(expBuf, actBuf)
    }

    if (expBuf.length !== actBuf.length) {
      return false
    }

    let diff = 0
    for (let i = 0; i < expBuf.length; i++) {
      diff |= expBuf[i] ^ actBuf[i]
    }
    return diff === 0
  } catch {
    return false
  }
}

/**
 * Normalize a Flutterwave webhook payload into CampusCab's internal payment status.
 *
 * We prefer the authoritative tx_ref verification over payload fields; this
 * function is only used to mirror status fields for logging and to surface a
 * failure reason when present.
 */
export function normalizeWebhookEvent(
  providerReference: string,
  payload: Record<string, unknown>
): VerifyPaymentResult {
  const event = String(payload.event ?? '')
  const data = payload.data as Record<string, unknown> | null
  const status = data ? String(data.status ?? '').toLowerCase() : ''

  if (event === 'charge.failed' || event === 'charge.expired' || event === 'charge.cancelled') {
    return {
      status: 'failed',
      providerReference,
      failureReason: String(data?.narration ?? data?.processor_response ?? data?.message ?? 'Payment not successful'),
    }
  }

  if (status === 'successful') {
    return {
      status: 'successful',
      providerReference,
      paidAt: (data?.paid_at as string | undefined) ?? new Date().toISOString(),
    }
  }

  if (status === 'failed' || status === 'cancelled' || status === 'expired') {
    return {
      status: 'failed',
      providerReference,
      failureReason: String(data?.narration ?? data?.processor_response ?? data?.message ?? 'Payment not successful'),
    }
  }

  return { status: 'pending' }
}

export type BankAccountResolution =
  | { accountName: string }
  | {
      error: string;
      /**
       * True when the lookup could not be attempted or reached Flutterwave
       * (missing key, network failure). A non-retryable error means the
       * provider answered and rejected the account itself.
       */
      unavailable?: boolean;
    }

/**
 * Resolve a Naira bank account to its registered account name.
 *
 * This is the only trustworthy way to know who owns an account number — the
 * driver-typed name is never used as the payee name when the lookup succeeds.
 * Docs: https://developer.flutterwave.com/reference/resolve_account
 */
export async function resolveBankAccount({
  bankCode,
  accountNumber,
}: {
  bankCode: string
  accountNumber: string
}): Promise<BankAccountResolution> {
  if (!SECRET_KEY) {
    return { error: envError('FLUTTERWAVE_SECRET_KEY'), unavailable: true }
  }

  let response: Response
  try {
    response = await fetch(`${FLUTTERWAVE_BASE_URL}/accounts/resolve`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        account_number: accountNumber,
        account_bank: bankCode,
      }),
    })
  } catch {
    return { error: 'Could not reach Flutterwave to verify this account.', unavailable: true }
  }

  const result = (await response.json().catch(() => ({}))) as {
    message?: string
    data?: { account_name?: unknown }
  }

  const accountName = result.data?.account_name
  if (!response.ok) {
    // Only an answer about the account itself can block a driver from saving.
    // Credential problems (401/403), provider outages (5xx) and rate limits
    // (429) say nothing about the account, so the details are kept unverified
    // rather than rejected.
    const configOrProviderFault =
      response.status === 401 ||
      response.status === 403 ||
      response.status === 429 ||
      response.status >= 500

    return {
      error:
        typeof result.message === 'string' && result.message
          ? result.message
          : 'Could not verify this bank account. Check the bank, account number and name.',
      ...(configOrProviderFault ? { unavailable: true } : {}),
    }
  }

  if (typeof accountName !== 'string' || !accountName.trim()) {
    return {
      error:
        typeof result.message === 'string' && result.message
          ? result.message
          : 'Could not verify this bank account. Check the bank, account number and name.',
    }
  }

  return { accountName: accountName.trim() }
}

/**
 * Initiate a driver payout via Flutterwave transfers.
 *
 * Fluttterwave bank transfers are a separate merchant feature and require:
 *   - KYC approved for transfers
 *   - Server IP whitelisted
 *   - Transfers API enabled on the dashboard
 *
 * If any of those is not active for this merchant account, this function
 * returns an explicit error instead of pretending transfers work.
 *
 * Docs: https://developer.flutterwave.com/docs/nigerian-bank-account-transfer
 */
export async function createPayout(request: {
  provider: 'FLUTTERWAVE'
  driverId: string
  amountInSmallestUnit: number
  recipient: {
    name: string
    phone?: string
    bankCode?: string
    bankName?: string
    accountNumber?: string
    accountName?: string
  }
  reference: string
}): Promise<{ providerReference?: string; status?: 'processing' | 'success' | 'failed'; error?: string }> {
  if (!SECRET_KEY) {
    return { error: envError('FLUTTERWAVE_SECRET_KEY') }
  }

  // Transfers are not attempted until the merchant account is explicitly approved
  // for payouts. Do not silently proceed.
  if (!process.env.FLUTTERWAVE_TRANSFERS_ENABLED) {
    return {
      error: 'Flutterwave payouts are not enabled yet. Set FLUTTERWAVE_TRANSFERS_ENABLED=1 only after transfers are approved on the Flutterwave dashboard (KYC, server IP whitelist, Transfers API enabled).',
    }
  }

  // We currently support bank account transfers only. Provider-specific wallet
  // recipient IDs (if any) are not implemented yet.
  if (!request.recipient.bankCode || !request.recipient.accountNumber) {
    return { error: 'Flutterwave payout requires a bank code and account number for the driver' }
  }

  const payload = {
    amount: String(Math.round(request.amountInSmallestUnit / 100)), // Flutterwave transfers use NGN units, not kobo
    account_bank: request.recipient.bankCode,
    account_number: request.recipient.accountNumber,
    currency: 'NGN',
    narration: `CampusCab driver payout — trip ${request.driverId}`,
    reference: request.reference,
    beneficiary_name: request.recipient.name,
  }

  let response: Response
  try {
    response = await fetch(`${FLUTTERWAVE_BASE_URL}/transfers`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    })
  } catch {
    return { error: 'Failed to connect to Flutterwave during payout initiation' }
  }

  const result = (await response.json()) as Record<string, unknown>

  if (!response.ok) {
    return { error: String(result.message ?? result.error ?? 'Flutterwave payout initiation failed') }
  }

  const data = result.data as Record<string, unknown> | null
  const transferRef =
    typeof data?.reference === 'string'
      ? data.reference
      : typeof data?.id === 'number'
        ? String(data.id)
        : request.reference

  const transferStatus = String(data?.status ?? 'NEW').toUpperCase()
  const status: 'processing' | 'success' | 'failed' =
    transferStatus === 'SUCCESSFUL'
      ? 'success'
      : transferStatus === 'FAILED' || transferStatus === 'REJECTED'
        ? 'failed'
        : 'processing'

  return { providerReference: transferRef, status }
}

export const FLUTTERWAVE_WEBHOOK_HEADER = 'verif-hash'

/**
 * Initiate the school's daily commission transfer via Flutterwave transfers.
 *
 * Same merchant requirements as driver payouts: KYC approved, server IP
 * whitelisted and the Transfers API enabled — which is why this is gated on
 * FLUTTERWAVE_TRANSFERS_ENABLED and returns an explicit error otherwise.
 * The caller (settlement engine) records the outcome; a "processing" result
 * is NEVER treated as money delivered — it must be verified with
 * fetchTransfer() before any ledger entry is marked settled.
 *
 * Docs: https://developer.flutterwave.com/reference#/operations/createtransfer
 */
export async function createSchoolTransfer(request: {
  amountKobo: number
  reference: string
  recipient: { bankCode: string; accountNumber: string; accountName?: string }
  narration?: string
}): Promise<{
  providerReference?: string
  status?: 'processing' | 'successful' | 'failed'
  error?: string
}> {
  if (!SECRET_KEY) {
    return { error: envError('FLUTTERWAVE_SECRET_KEY') }
  }

  if (!process.env.FLUTTERWAVE_TRANSFERS_ENABLED) {
    return {
      error:
        'Flutterwave transfers are not enabled. Set FLUTTERWAVE_TRANSFERS_ENABLED=1 only after transfers are approved on the Flutterwave dashboard (KYC, IP whitelist, Transfers API).',
    }
  }

  if (!request.recipient.bankCode || !request.recipient.accountNumber) {
    return { error: 'School recipient bank code and account number are not configured' }
  }

  if (!Number.isInteger(request.amountKobo) || request.amountKobo <= 0) {
    return { error: `Invalid transfer amount: ${request.amountKobo} kobo` }
  }

  const payload = {
    // Flutterwave transfers use NGN major units, not kobo.
    amount: (request.amountKobo / 100).toFixed(2),
    account_bank: request.recipient.bankCode,
    account_number: request.recipient.accountNumber,
    currency: 'NGN',
    narration: request.narration ?? 'CampusCab daily school commission',
    reference: request.reference,
    ...(request.recipient.accountName
      ? { beneficiary_name: request.recipient.accountName }
      : {}),
  }

  let response: Response
  try {
    response = await fetch(`${FLUTTERWAVE_BASE_URL}/transfers`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    })
  } catch {
    return { error: 'Failed to connect to Flutterwave during commission transfer initiation' }
  }

  const result = (await response.json()) as Record<string, unknown>

  if (!response.ok) {
    return { error: String(result.message ?? result.error ?? 'Flutterwave commission transfer failed') }
  }

  const data = result.data as Record<string, unknown> | null
  const transferRef =
    typeof data?.reference === 'string'
      ? data.reference
      : typeof data?.id === 'number'
        ? String(data.id)
        : request.reference

  const transferStatus = String(data?.status ?? 'NEW').toUpperCase()
  const status: 'processing' | 'successful' | 'failed' =
    transferStatus === 'SUCCESSFUL'
      ? 'successful'
      : transferStatus === 'FAILED' || transferStatus === 'REJECTED'
        ? 'failed'
        : 'processing'

  return { providerReference: transferRef, status }
}

/**
 * Fetch the authoritative status of a previously initiated transfer by its
 * reference. Used by settlement verification, the scheduled reconciliation
 * pass and transfer webhooks. Network failures return an error and leave the
 * caller's state untouched — an unknown outcome is never assumed successful.
 *
 * Docs: https://developer.flutterwave.com/reference#/operations/ustransferfetchbyreference
 */
export async function fetchTransfer(reference: string): Promise<{
  status: 'successful' | 'failed' | 'processing' | 'pending'
  providerReference?: string
  /** Amount as reported by Flutterwave, in NGN major units. */
  amount?: number
  currency?: string
  failureReason?: string
  error?: string
}> {
  if (!SECRET_KEY) {
    return { status: 'pending', error: envError('FLUTTERWAVE_SECRET_KEY') }
  }

  let response: Response
  try {
    response = await fetch(
      `${FLUTTERWAVE_BASE_URL}/transfers/fetch_by_reference?reference=${encodeURIComponent(reference)}`,
      { method: 'GET', headers: authHeaders() }
    )
  } catch {
    return { status: 'pending', error: 'Failed to connect to Flutterwave during transfer verification' }
  }

  const result = (await response.json()) as Record<string, unknown>

  if (!response.ok) {
    return { status: 'pending', error: String(result.message ?? result.error ?? 'Flutterwave transfer fetch failed') }
  }

  const data = result.data as Record<string, unknown> | null
  if (!data) {
    return { status: 'pending', error: 'Flutterwave returned an empty transfer payload' }
  }

  const rawStatus = String(data.status ?? '').toUpperCase()
  const amount = Number(data.amount)
  const currency = String(data.currency ?? '').toUpperCase()
  const providerReference =
    typeof data.reference === 'string' ? data.reference : reference
  const failureReason =
    typeof data.complete_message === 'string' && data.complete_message
      ? data.complete_message
      : typeof data.fail_message === 'string' && data.fail_message
        ? data.fail_message
        : undefined

  const base = {
    providerReference,
    ...(Number.isFinite(amount) ? { amount } : {}),
    ...(currency ? { currency } : {}),
    ...(failureReason ? { failureReason } : {}),
  }

  if (rawStatus === 'SUCCESSFUL') return { status: 'successful', ...base }
  if (rawStatus === 'FAILED' || rawStatus === 'REJECTED') return { status: 'failed', ...base }
  if (rawStatus === 'PROCESSING') return { status: 'processing', ...base }
  return { status: 'pending', ...base }
}
