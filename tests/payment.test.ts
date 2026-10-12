import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import { prisma, cleanDatabase, createTestStudent, getTestLocation } from './setup'

/**
 * Flutterwave integration tests.
 *
 * - All Flutterwave HTTP calls are mocked via global fetch, so no real
 *   merchant account, credentials, or internet access are required.
 * - `@/lib/prisma` is redirected to the SQLite test client, `@/lib/auth` is
 *   replaced with a controllable fake session, and `next/headers` returns a
 *   unique IP per call so rate limits never collide between tests.
 * - Route handlers and server actions are invoked directly (no HTTP server),
 *   with absolute request URLs.
 */

// ── hoisted environment (runs before any module import) ────────────────────

vi.hoisted(() => {
  process.env.FLUTTERWAVE_SECRET_KEY = 'FLWSECK_TEST_SECRET'
  process.env.FLUTTERWAVE_WEBHOOK_SECRET = 'test-webhook-secret'
  delete process.env.FLUTTERWAVE_TRANSFERS_ENABLED
})

const sessionState = vi.hoisted(() => ({
  user: null as { id: string; email: string; role: string } | null,
}))

const rateLimitIp = vi.hoisted(() => ({ n: 0 }))

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () => (sessionState.user ? { user: { ...sessionState.user } } : null)),
  getUserId: vi.fn(async () => {
    throw new Error('Not authenticated')
  }),
  getUserRole: vi.fn(async () => {
    throw new Error('Not authenticated')
  }),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-forwarded-for': `test-ip-${++rateLimitIp.n}` })),
}))

vi.mock('@/lib/prisma', async () => {
  const setup = await import('./setup')
  return { prisma: setup.prisma }
})

// ── helpers ────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = 'test-webhook-secret'
const realFetch = globalThis.fetch
let refCounter = 0

function uniqRef(prefix = 'ccab-test'): string {
  return `${prefix}-${Date.now().toString(36)}-${(refCounter++).toString(36)}`
}

function signInAs(user: { id: string; email: string; role: string }) {
  sessionState.user = user
}

function signOut() {
  sessionState.user = null
}

function apiReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response
}

function initOkBody(link = 'https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-test') {
  return { status: 'success', message: 'Hosted Link', data: { link, tx_ref: 'ignored' } }
}

function verifyOkBody(opts: { amount?: number; currency?: string; status?: string } = {}) {
  const { amount = 210, currency = 'NGN', status = 'successful' } = opts
  return {
    status: 'success',
    message: 'Transaction verified',
    data: {
      id: 12345,
      tx_ref: 'ccab-x',
      flw_ref: 'FLW_test',
      amount,
      currency,
      status,
      paid_at: new Date().toISOString(),
      gateway_response: 'successful',
    },
  }
}

type FetchScript = {
  init?: { ok?: boolean; status?: number; body?: unknown }
  verify?: { ok?: boolean; status?: number; body?: unknown }
}

/** Install a fetch mock that answers Flutterwave init/verify calls. */
function installFlutterwaveFetch(script: FetchScript = {}) {
  const mock = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.includes('/v3/payments')) {
      const s = script.init ?? {}
      return jsonResponse(s.body ?? initOkBody(), s.ok ?? true, s.status ?? 200)
    }
    if (url.includes('/transactions/verify_by_reference')) {
      const s = script.verify ?? {}
      return jsonResponse(s.body ?? verifyOkBody(), s.ok ?? true, s.status ?? 200)
    }
    if (url.includes('/v3/transfers')) {
      return jsonResponse({ status: 'error', message: 'transfers not available' }, false, 403)
    }
    throw new Error(`Unexpected external request in test: ${url}`)
  })
  globalThis.fetch = mock as unknown as typeof fetch
  return mock
}

async function makeTrip(
  studentUserId: string,
  rideType: 'SHARED_SHUTTLE' | 'SOLO_QUICK_CAB'
) {
  const student = await prisma.student.findUnique({ where: { userId: studentUserId } })
  if (!student) throw new Error('student not found')
  const pickup = await getTestLocation('Library')
  const dropoff = await getTestLocation('Science Block')
  return prisma.trip.create({
    data: {
      studentId: student.id,
      pickupLocationId: pickup.id,
      dropoffLocationId: dropoff.id,
      passengerCount: 1,
      rideType,
      totalFare: rideType === 'SHARED_SHUTTLE' ? 210 : 810,
      status: 'PENDING',
    },
  })
}

async function seedPayment(opts: {
  userId: string
  tripId: string
  reference?: string
  rideFare?: number
  platformFee?: number
  totalAmount?: number
  status?: 'PENDING' | 'SUCCESSFUL' | 'FAILED'
  providerReference?: string | null
}) {
  const {
    userId,
    tripId,
    reference = uniqRef(),
    rideFare = 200,
    platformFee = 10,
    totalAmount = 210,
    status = 'PENDING',
    providerReference,
  } = opts
  const ref = providerReference ?? reference
  return prisma.payment.create({
    data: {
      userId,
      tripId,
      reference,
      passengerCount: 1,
      rideFare,
      platformFee,
      totalAmount,
      currency: 'NGN',
      status,
      provider: 'FLUTTERWAVE',
      providerReference: ref,
      paidAt: status === 'SUCCESSFUL' ? new Date() : null,
    },
  })
}

function webhookEvent(body: unknown, signature?: string | null) {
  return {
    provider: 'FLUTTERWAVE' as const,
    rawBody: JSON.stringify(body),
    ...(signature === undefined ? {} : { signatureHeader: signature ?? undefined }),
  }
}

function walkSrc(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walkSrc(full) : [full]
  })
}

function readProjectFile(rel: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
}

function srcOffenders(pattern: RegExp): string[] {
  const files = walkSrc(path.resolve(process.cwd(), 'src'))
  return files.filter((file) => pattern.test(fs.readFileSync(file, 'utf8')))
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('Flutterwave payments', () => {
  beforeAll(async () => {
    await cleanDatabase()
  })

  afterAll(async () => {
    await cleanDatabase()
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    signOut()
  })

  describe('Payment initialization', () => {
    it('rejects unauthenticated init with 401', async () => {
      const { POST } = await import('@/app/api/payments/route')
      const res = await POST(
        apiReq('http://localhost/api/payments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tripId: 'any' }),
        })
      )
      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toContain('logged in')
    })

    it('returns 400 when tripId is missing', async () => {
      const student = await createTestStudent({ email: 'init-missing@example.com' })
      signInAs({ id: student.id, email: student.email, role: 'STUDENT' })
      const { POST } = await import('@/app/api/payments/route')
      const res = await POST(
        apiReq('http://localhost/api/payments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        })
      )
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBe('tripId is required')
    })

    it('initializes a SHARED_SHUTTLE payment server-side at ₦210 (₦200 + ₦10)', async () => {
      const student = await createTestStudent({ email: 'init-shared@example.com' })
      signInAs({ id: student.id, email: student.email, role: 'STUDENT' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')

      const fetchMock = installFlutterwaveFetch()
      const { POST } = await import('@/app/api/payments/route')
      const res = await POST(
        apiReq('http://localhost/api/payments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tripId: trip.id }),
        })
      )
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.checkoutUrl).toContain('https://')

      // Server-side amount sent to Flutterwave: NGN major units, server-computed.
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('https://api.flutterwave.com/v3/payments')
      const payload = JSON.parse((init as RequestInit).body as string)
      expect(payload.amount).toBe('210')
      expect(payload.currency).toBe('NGN')
      expect(payload.tx_ref).toMatch(/^ccab-/)
      expect(payload.redirect_url).toContain(payload.tx_ref)

      // Exactly one payment record — no duplicate payment rows.
      const rows = await prisma.payment.findMany({ where: { tripId: trip.id } })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        rideFare: 200,
        platformFee: 10,
        totalAmount: 210,
        currency: 'NGN',
        status: 'PENDING',
        provider: 'FLUTTERWAVE',
        reference: payload.tx_ref,
      })
    })

    it('initializes a SOLO_QUICK_CAB payment server-side at ₦810 (₦800 + ₦10)', async () => {
      const student = await createTestStudent({ email: 'init-solo@example.com' })
      signInAs({ id: student.id, email: student.email, role: 'STUDENT' })
      const trip = await makeTrip(student.id, 'SOLO_QUICK_CAB')

      const fetchMock = installFlutterwaveFetch()
      const { POST } = await import('@/app/api/payments/route')
      const res = await POST(
        apiReq('http://localhost/api/payments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tripId: trip.id }),
        })
      )
      expect(res.status).toBe(200)

      const payload = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
      expect(payload.amount).toBe('810')

      const row = await prisma.payment.findFirst({ where: { tripId: trip.id } })
      expect(row).toMatchObject({ rideFare: 800, platformFee: 10, totalAmount: 810 })
    })

    it('ignores any provider requested by the frontend — always FLUTTERWAVE', async () => {
      const student = await createTestStudent({ email: 'init-prov@example.com' })
      signInAs({ id: student.id, email: student.email, role: 'STUDENT' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')

      installFlutterwaveFetch()
      const { POST } = await import('@/app/api/payments/route')
      const res = await POST(
        apiReq('http://localhost/api/payments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tripId: trip.id, provider: 'PALMPAY' }),
        })
      )
      expect(res.status).toBe(200)
      const row = await prisma.payment.findFirst({ where: { tripId: trip.id } })
      expect(row?.provider).toBe('FLUTTERWAVE')
    })

    it('returns 409 when the trip is already paid for (duplicate payment)', async () => {
      const student = await createTestStudent({ email: 'init-dup@example.com' })
      signInAs({ id: student.id, email: student.email, role: 'STUDENT' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')
      await seedPayment({
        userId: student.id,
        tripId: trip.id,
        status: 'SUCCESSFUL',
        providerReference: 'flw-dup-seed',
      })

      installFlutterwaveFetch()
      const { POST } = await import('@/app/api/payments/route')
      const res = await POST(
        apiReq('http://localhost/api/payments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tripId: trip.id }),
        })
      )
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.error).toContain('already been paid')
    })

    it('rejects paying for another student’s trip', async () => {
      const owner = await createTestStudent({ email: 'owner@example.com' })
      const other = await createTestStudent({ email: 'foreign@example.com' })
      const trip = await makeTrip(owner.id, 'SHARED_SHUTTLE')
      signInAs({ id: other.id, email: other.email, role: 'STUDENT' })

      installFlutterwaveFetch()
      const { POST } = await import('@/app/api/payments/route')
      const res = await POST(
        apiReq('http://localhost/api/payments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tripId: trip.id }),
        })
      )
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('your own trips')
    })

    it('marks the payment FAILED when Flutterwave initialization fails', async () => {
      const student = await createTestStudent({ email: 'init-fail@example.com' })
      signInAs({ id: student.id, email: student.email, role: 'STUDENT' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')

      installFlutterwaveFetch({
        init: { ok: false, status: 500, body: { message: 'Bank unavailable' } },
      })
      const { POST } = await import('@/app/api/payments/route')
      const res = await POST(
        apiReq('http://localhost/api/payments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tripId: trip.id }),
        })
      )
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toContain('Bank unavailable')

      const row = await prisma.payment.findFirst({ where: { tripId: trip.id } })
      expect(row?.status).toBe('FAILED')
      expect(row?.failureReason).toContain('Bank unavailable')
    })

    it('reuses the pending payment row on re-init instead of duplicating records', async () => {
      const student = await createTestStudent({ email: 'init-retry@example.com' })
      signInAs({ id: student.id, email: student.email, role: 'STUDENT' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')

      const fetchMock = installFlutterwaveFetch()
      const { POST } = await import('@/app/api/payments/route')
      const post = () =>
        POST(
          apiReq('http://localhost/api/payments', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tripId: trip.id }),
          })
        )

      expect((await post()).status).toBe(200)
      expect((await post()).status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(2)

      const rows = await prisma.payment.findMany({ where: { tripId: trip.id } })
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('PENDING')

      // A fresh tx_ref is issued for the second checkout attempt.
      const firstRef = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
        .tx_ref as string
      const secondRef = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)
        .tx_ref as string
      expect(secondRef).not.toBe(firstRef)
      expect(rows[0].reference).toBe(secondRef)
    })
  })

  describe('Payment verification (server-side)', () => {
    it('confirms a successful transaction and credits the trip', async () => {
      const student = await createTestStudent({ email: 'verify-ok@example.com' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')
      const payment = await seedPayment({ userId: student.id, tripId: trip.id })

      installFlutterwaveFetch({ verify: { body: verifyOkBody({ amount: 210 }) } })
      const { verifyPayment } = await import('@/lib/payments')
      const result = await verifyPayment(payment.reference)
      expect(result.success).toBe(true)

      const row = await prisma.payment.findUnique({ where: { id: payment.id } })
      expect(row?.status).toBe('SUCCESSFUL')
      expect(row?.paidAt).not.toBeNull()

      const updatedTrip = await prisma.trip.findUnique({ where: { id: trip.id } })
      expect(updatedTrip?.appCharge).toBe(10)
      expect(updatedTrip?.driverEarnings).toBe(200)
    })

    it('is idempotent — an already-verified payment is not reprocessed', async () => {
      const student = await createTestStudent({ email: 'verify-idem@example.com' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')
      const payment = await seedPayment({
        userId: student.id,
        tripId: trip.id,
        status: 'SUCCESSFUL',
      })

      const fetchMock = installFlutterwaveFetch()
      const { verifyPayment } = await import('@/lib/payments')
      const result = await verifyPayment(payment.reference)
      expect(result.success).toBe(true)
      expect(result.alreadyVerified).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('marks FAILED when Flutterwave reports a failed transaction', async () => {
      const student = await createTestStudent({ email: 'verify-fail@example.com' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')
      const payment = await seedPayment({ userId: student.id, tripId: trip.id })

      installFlutterwaveFetch({
        verify: { body: verifyOkBody({ amount: 210, status: 'failed' }) },
      })
      const { verifyPayment } = await import('@/lib/payments')
      const result = await verifyPayment(payment.reference)
      expect(result.success).toBe(false)

      const row = await prisma.payment.findUnique({ where: { id: payment.id } })
      expect(row?.status).toBe('FAILED')
      expect(row?.failureReason).toBeTruthy()
    })

    it('treats expired transactions as failed', async () => {
      const student = await createTestStudent({ email: 'verify-expired@example.com' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')
      const payment = await seedPayment({ userId: student.id, tripId: trip.id })

      installFlutterwaveFetch({
        verify: { body: verifyOkBody({ amount: 210, status: 'expired' }) },
      })
      const { verifyPayment } = await import('@/lib/payments')
      const result = await verifyPayment(payment.reference)
      expect(result.success).toBe(false)

      const row = await prisma.payment.findUnique({ where: { id: payment.id } })
      expect(row?.status).toBe('FAILED')
    })

    it('keeps pending transactions pending', async () => {
      const student = await createTestStudent({ email: 'verify-pending@example.com' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')
      const payment = await seedPayment({ userId: student.id, tripId: trip.id })

      installFlutterwaveFetch({
        verify: { body: verifyOkBody({ amount: 210, status: 'processing' }) },
      })
      const { verifyPayment } = await import('@/lib/payments')
      const result = await verifyPayment(payment.reference)
      expect(result.success).toBe(false)
      expect(result.pending).toBe(true)

      const row = await prisma.payment.findUnique({ where: { id: payment.id } })
      expect(row?.status).toBe('PENDING')
    })

    it('rejects an amount mismatch (₦5,000 verified vs ₦210 expected)', async () => {
      const student = await createTestStudent({ email: 'verify-amount@example.com' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')
      const payment = await seedPayment({ userId: student.id, tripId: trip.id })

      installFlutterwaveFetch({ verify: { body: verifyOkBody({ amount: 5000 }) } })
      const { verifyPayment } = await import('@/lib/payments')
      const result = await verifyPayment(payment.reference)
      expect(result.success).toBe(false)
      expect(String(result.error)).toContain('Amount mismatch')

      const row = await prisma.payment.findUnique({ where: { id: payment.id } })
      expect(row?.status).toBe('FAILED')
      expect(row?.failureReason).toContain('Amount mismatch')
    })

    it('rejects a currency mismatch (USD verified vs NGN expected)', async () => {
      const student = await createTestStudent({ email: 'verify-currency@example.com' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')
      const payment = await seedPayment({ userId: student.id, tripId: trip.id })

      installFlutterwaveFetch({
        verify: { body: verifyOkBody({ amount: 210, currency: 'USD' }) },
      })
      const { verifyPayment } = await import('@/lib/payments')
      const result = await verifyPayment(payment.reference)
      expect(result.success).toBe(false)
      expect(String(result.error)).toContain('Currency mismatch')

      const row = await prisma.payment.findUnique({ where: { id: payment.id } })
      expect(row?.status).toBe('FAILED')
    })

    it('returns an error for an unknown transaction reference', async () => {
      const fetchMock = installFlutterwaveFetch()
      const { verifyPayment } = await import('@/lib/payments')
      const result = await verifyPayment('ccab-does-not-exist')
      expect(result.success).toBe(false)
      expect(String(result.error)).toContain('not found')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('Webhook verification', () => {
    it('rejects an invalid verif-hash signature', async () => {
      const { handleWebhookProvider } = await import('@/lib/payments')
      const processed = await handleWebhookProvider(
        webhookEvent({ event: 'charge.completed', data: { tx_ref: 'x' } }, 'wrong-secret')
      )
      expect(processed).toBe(false)
    })

    it('rejects a missing signature', async () => {
      const { handleWebhookProvider } = await import('@/lib/payments')
      const processed = await handleWebhookProvider(
        webhookEvent({ event: 'charge.completed', data: { tx_ref: 'x' } }, null)
      )
      expect(processed).toBe(false)
    })

    it('route returns 401 for an invalid signature', async () => {
      const { POST } = await import('@/app/api/payments/webhook/route')
      const res = await POST(
        apiReq('http://localhost/api/payments/webhook', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'verif-hash': 'wrong' },
          body: JSON.stringify({ event: 'charge.completed', data: { tx_ref: 'x' } }),
        })
      )
      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toContain('signature')
    })

    it('route returns 405 for GET requests', async () => {
      const { GET } = await import('@/app/api/payments/webhook/route')
      const res = await GET()
      expect(res.status).toBe(405)
      const json = await res.json()
      expect(json.error).toBe('Method not allowed')
    })

    it('processes a valid successful event after re-verifying with Flutterwave', async () => {
      const student = await createTestStudent({ email: 'wh-ok@example.com' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')
      const payment = await seedPayment({ userId: student.id, tripId: trip.id })

      installFlutterwaveFetch({ verify: { body: verifyOkBody({ amount: 210 }) } })
      const { handleWebhookProvider } = await import('@/lib/payments')
      const processed = await handleWebhookProvider(
        webhookEvent(
          {
            event: 'charge.completed',
            data: { tx_ref: payment.reference, status: 'successful', amount: 210, currency: 'NGN' },
          },
          WEBHOOK_SECRET
        )
      )
      expect(processed).toBe(true)

      const row = await prisma.payment.findUnique({ where: { id: payment.id } })
      expect(row?.status).toBe('SUCCESSFUL')
      const updatedTrip = await prisma.trip.findUnique({ where: { id: trip.id } })
      expect(updatedTrip?.driverEarnings).toBe(200)
      expect(updatedTrip?.appCharge).toBe(10)
    })

    it('is idempotent — duplicate webhook deliveries confirm once', async () => {
      const student = await createTestStudent({ email: 'wh-dup@example.com' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')
      const payment = await seedPayment({ userId: student.id, tripId: trip.id })

      const fetchMock = installFlutterwaveFetch({
        verify: { body: verifyOkBody({ amount: 210 }) },
      })
      const { handleWebhookProvider } = await import('@/lib/payments')
      const event = webhookEvent(
        {
          event: 'charge.completed',
          data: { tx_ref: payment.reference, status: 'successful', amount: 210, currency: 'NGN' },
        },
        WEBHOOK_SECRET
      )

      expect(await handleWebhookProvider(event)).toBe(true)
      expect(await handleWebhookProvider(event)).toBe(true)

      // Second delivery short-circuits: no second provider verification, no
      // duplicate payment records, trip credited exactly once.
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const rows = await prisma.payment.findMany({ where: { tripId: trip.id } })
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('SUCCESSFUL')
    })

    it('does not confirm when the verified amount mismatches', async () => {
      const student = await createTestStudent({ email: 'wh-amount@example.com' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')
      const payment = await seedPayment({ userId: student.id, tripId: trip.id })

      installFlutterwaveFetch({ verify: { body: verifyOkBody({ amount: 99999 }) } })
      const { handleWebhookProvider } = await import('@/lib/payments')
      const processed = await handleWebhookProvider(
        webhookEvent(
          {
            event: 'charge.completed',
            data: { tx_ref: payment.reference, status: 'successful', amount: 99999, currency: 'NGN' },
          },
          WEBHOOK_SECRET
        )
      )
      // Acknowledged so Flutterwave stops retrying, but NOT confirmed.
      expect(processed).toBe(true)
      const row = await prisma.payment.findUnique({ where: { id: payment.id } })
      expect(row?.status).not.toBe('SUCCESSFUL')
    })

    it('marks the payment FAILED on charge.failed events', async () => {
      const student = await createTestStudent({ email: 'wh-failed@example.com' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')
      const payment = await seedPayment({ userId: student.id, tripId: trip.id })

      installFlutterwaveFetch()
      const { handleWebhookProvider } = await import('@/lib/payments')
      const processed = await handleWebhookProvider(
        webhookEvent(
          {
            event: 'charge.failed',
            data: { tx_ref: payment.reference, status: 'failed', amount: 210, currency: 'NGN' },
          },
          WEBHOOK_SECRET
        )
      )
      expect(processed).toBe(true)
      const row = await prisma.payment.findUnique({ where: { id: payment.id } })
      expect(row?.status).toBe('FAILED')
    })

    it('acknowledges an unknown reference without acting on it', async () => {
      const before = await prisma.payment.count()
      installFlutterwaveFetch()
      const { handleWebhookProvider } = await import('@/lib/payments')
      const processed = await handleWebhookProvider(
        webhookEvent(
          { event: 'charge.completed', data: { tx_ref: 'ccab-ghost', status: 'successful' } },
          WEBHOOK_SECRET
        )
      )
      expect(processed).toBe(true)
      expect(await prisma.payment.count()).toBe(before)
    })

    it('route returns 200 with received:true for a valid signature', async () => {
      const { POST } = await import('@/app/api/payments/webhook/route')
      const res = await POST(
        apiReq('http://localhost/api/payments/webhook', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'verif-hash': WEBHOOK_SECRET },
          body: JSON.stringify({
            event: 'charge.completed',
            data: { tx_ref: 'ccab-ghost-route', status: 'successful' },
          }),
        })
      )
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.received).toBe(true)
    })
  })

  describe('Checkout callback (redirect is never trusted alone)', () => {
    it('confirms only after server-side verification', async () => {
      const student = await createTestStudent({ email: 'cb-ok@example.com' })
      signInAs({ id: student.id, email: student.email, role: 'STUDENT' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')
      const payment = await seedPayment({ userId: student.id, tripId: trip.id })

      installFlutterwaveFetch({ verify: { body: verifyOkBody({ amount: 210 }) } })
      const { GET } = await import('@/app/api/payments/verify/route')
      const res = await GET(
        apiReq(`http://localhost/api/payments/verify?reference=${payment.reference}`)
      )
      expect(res.status).toBeGreaterThanOrEqual(300)
      expect(res.headers.get('location')).toContain('payment=success')

      const row = await prisma.payment.findUnique({ where: { id: payment.id } })
      expect(row?.status).toBe('SUCCESSFUL')
    })

    it('does not confirm a pending transaction', async () => {
      const student = await createTestStudent({ email: 'cb-pending@example.com' })
      signInAs({ id: student.id, email: student.email, role: 'STUDENT' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')
      const payment = await seedPayment({ userId: student.id, tripId: trip.id })

      installFlutterwaveFetch({
        verify: { body: verifyOkBody({ amount: 210, status: 'processing' }) },
      })
      const { GET } = await import('@/app/api/payments/verify/route')
      const res = await GET(
        apiReq(`http://localhost/api/payments/verify?reference=${payment.reference}`)
      )
      expect(res.headers.get('location')).toContain('payment=pending')

      const row = await prisma.payment.findUnique({ where: { id: payment.id } })
      expect(row?.status).toBe('PENDING')
    })

    it('redirects to payment=failed when verification fails', async () => {
      const student = await createTestStudent({ email: 'cb-fail@example.com' })
      signInAs({ id: student.id, email: student.email, role: 'STUDENT' })
      const trip = await makeTrip(student.id, 'SHARED_SHUTTLE')
      const payment = await seedPayment({ userId: student.id, tripId: trip.id })

      installFlutterwaveFetch({
        verify: { body: verifyOkBody({ amount: 210, status: 'failed' }) },
      })
      const { GET } = await import('@/app/api/payments/verify/route')
      const res = await GET(
        apiReq(`http://localhost/api/payments/verify?reference=${payment.reference}`)
      )
      expect(res.headers.get('location')).toContain('payment=failed')

      const row = await prisma.payment.findUnique({ where: { id: payment.id } })
      expect(row?.status).toBe('FAILED')
    })

    it('redirects to an error for an unknown reference', async () => {
      const { GET } = await import('@/app/api/payments/verify/route')
      const res = await GET(
        apiReq('http://localhost/api/payments/verify?reference=ccab-nope')
      )
      expect(res.headers.get('location')).toContain('payment=error')
      expect(res.headers.get('location')).toContain('not_found')
    })

    it('redirects to an error when no reference is supplied', async () => {
      const { GET } = await import('@/app/api/payments/verify/route')
      const res = await GET(apiReq('http://localhost/api/payments/verify'))
      expect(res.headers.get('location')).toContain('payment=error')
      expect(res.headers.get('location')).toContain('no_reference')
    })
  })

  describe('Driver payouts', () => {
    async function setupPayoutTrip(paymentStatus: 'PENDING' | 'SUCCESSFUL', tripStatus: string) {
      const student = await createTestStudent({ email: `payout-s-${Date.now()}@example.com` })
      const driver = await createTestDriverForPayout()
      const trip = await makeTrip(student.id, 'SOLO_QUICK_CAB')
      await prisma.trip.update({
        where: { id: trip.id },
        data: { driverId: driver.driver.id, status: tripStatus },
      })
      const payment = await seedPayment({
        userId: student.id,
        tripId: trip.id,
        rideFare: 800,
        totalAmount: 810,
        status: paymentStatus,
        providerReference: paymentRef(),
      })
      return { student, driver, trip, payment }
    }

    async function createTestDriverForPayout() {
      const { createTestDriver } = await import('./setup')
      const driver = await createTestDriver({ email: `payout-d-${Date.now()}@example.com` })
      await prisma.driverPaymentAccount.create({
        data: {
          driverId: driver.driver!.id,
          provider: 'FLUTTERWAVE',
          bankCode: '044',
          bankName: 'Access Bank',
          accountNumber: '0123456789',
          accountName: driver.name,
        },
      })
      return driver
    }

    function paymentRef() {
      return uniqRef('flw-payout')
    }

    it('rejects payouts from students', async () => {
      const { student } = await setupPayoutTrip('SUCCESSFUL', 'COMPLETED')
      signInAs({ id: student.id, email: student.email, role: 'STUDENT' })

      const { initiateDriverPayout } = await import('@/lib/actions/payments')
      const trip = await prisma.trip.findFirst({ where: { studentId: student.student!.id } })
      const result = await initiateDriverPayout(trip!.id)
      expect(String(result.error)).toContain('Only drivers and admins')
    })

    it('does not pay out for an unpaid trip', async () => {
      const { driver, trip } = await setupPayoutTrip('PENDING', 'COMPLETED')
      signInAs({ id: driver.id, email: driver.email, role: 'DRIVER' })

      const { initiateDriverPayout } = await import('@/lib/actions/payments')
      const result = await initiateDriverPayout(trip.id)
      expect(String(result.error)).toContain('No successful payment')
      expect(await prisma.payout.count({ where: { tripId: trip.id } })).toBe(0)
    })

    it('does not pay out for an uncompleted trip', async () => {
      const { driver, trip } = await setupPayoutTrip('SUCCESSFUL', 'IN_PROGRESS')
      signInAs({ id: driver.id, email: driver.email, role: 'DRIVER' })

      const { initiateDriverPayout } = await import('@/lib/actions/payments')
      const result = await initiateDriverPayout(trip.id)
      expect(String(result.error)).toContain('not completed')
      expect(await prisma.payout.count({ where: { tripId: trip.id } })).toBe(0)
    })

    it('records a FAILED payout instead of pretending transfers work', async () => {
      const { driver, trip, payment } = await setupPayoutTrip('SUCCESSFUL', 'COMPLETED')
      signInAs({ id: driver.id, email: driver.email, role: 'DRIVER' })

      const { initiateDriverPayout } = await import('@/lib/actions/payments')
      const result = await initiateDriverPayout(trip.id)
      expect(result.success).toBeUndefined()
      expect(String(result.error)).toContain('not enabled')

      const payouts = await prisma.payout.findMany({ where: { tripId: trip.id } })
      expect(payouts).toHaveLength(1)
      expect(payouts[0]).toMatchObject({
        status: 'FAILED',
        provider: 'FLUTTERWAVE',
        paymentId: payment.id,
        amount: 800,
      })
      expect(payouts[0].failureReason).toContain('not enabled')
    })

    it('prevents duplicate transfers for the same trip', async () => {
      const { driver, trip, payment } = await setupPayoutTrip('SUCCESSFUL', 'COMPLETED')
      await prisma.payout.create({
        data: {
          tripId: trip.id,
          driverId: driver.driver!.id,
          paymentId: payment.id,
          provider: 'FLUTTERWAVE',
          providerReference: 'flw-transfer-1',
          amount: 800,
          status: 'SUCCESS',
          completedAt: new Date(),
        },
      })
      signInAs({ id: driver.id, email: driver.email, role: 'DRIVER' })

      const { initiateDriverPayout } = await import('@/lib/actions/payments')
      const result = await initiateDriverPayout(trip.id)
      expect(String(result.error)).toContain('already exists')

      expect(await prisma.payout.count({ where: { tripId: trip.id } })).toBe(1)
    })
  })

  describe('PalmPay and OPay removal', () => {
    it('has no PalmPay or OPay references left in src', () => {
      const offenders = srcOffenders(/\bpalmpay\b|\bopay\b/i)
      expect(offenders).toEqual([])
    })

    it('has no PalmPay or OPay dependencies in package.json', () => {
      const pkg = JSON.parse(readProjectFile('package.json'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      const offenders = Object.keys(deps).filter((name) => /palmpay|opay/i.test(name))
      expect(offenders).toEqual([])
    })

    it('has no provider selection/fallback code left in src', () => {
      const offenders = srcOffenders(/effectiveProvider|PAYMENT_PROVIDERS|providerModule/i)
      expect(offenders).toEqual([])
    })
  })

  describe('Map removal', () => {
    it('student dashboard has no map component or Leaflet import', () => {
      const page = readProjectFile('src/app/student/dashboard/page.tsx')
      expect(page).not.toMatch(/campus-map|leaflet|MapContainer/i)
    })

    it('driver dashboard has no map component or Leaflet import', () => {
      const page = readProjectFile('src/app/driver/dashboard/page.tsx')
      expect(page).not.toMatch(/campus-map|leaflet|MapContainer/i)
    })

    it('no mapping library references remain anywhere in src', () => {
      const offenders = srcOffenders(/leaflet|MapContainer|tileLayer/i)
      expect(offenders).toEqual([])
    })

    it('leaflet is not in package.json', () => {
      const pkg = JSON.parse(readProjectFile('package.json'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      expect(deps).not.toHaveProperty('leaflet')
      expect(deps).not.toHaveProperty('react-leaflet')
    })

    it('campus-map module has been deleted', async () => {
      let threw = false
      try {
        await import('@/components/campus-map')
      } catch {
        threw = true
      }
      expect(threw).toBe(true)
    })

    it('rides page renders the payment status banner', () => {
      const page = readProjectFile('src/app/student/rides/page.tsx')
      expect(page).toContain('PaymentStatusBanner')
    })
  })
})
