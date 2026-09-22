import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { verifyTransaction } from '@/lib/paystack';
import { logAudit } from '@/lib/audit';

/**
 * Paystack Webhook Handler.
 *
 * Paystack POSTs events here even if the student closes the callback page,
 * so payments always confirm server-side.
 *
 * Security:
 * 1. Signature verification (HMAC-SHA512 of the raw body with the secret key)
 * 2. Transaction is RE-VERIFIED against Paystack's API — the event payload
 *    is never trusted on its own (amount/status tampering protection)
 * 3. Idempotent — repeated deliveries never create duplicate records or
 *    double-update a trip
 * 4. Returns 200 only when safely processed; 5xx makes Paystack retry
 */

export const runtime = 'nodejs';

function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret || !signature) return false;

  const expected = createHmac('sha512', secret).update(rawBody).digest('hex');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;

  return timingSafeEqual(sigBuf, expBuf);
}

interface PaystackEvent {
  event: string;
  data?: {
    reference?: string;
    amount?: number; // kobo
    currency?: string;
    status?: string;
    paid_at?: string;
    id?: number;
    gateway_response?: string;
  };
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-paystack-signature');

  // 1. Signature check — reject anything not signed by Paystack
  if (!verifySignature(rawBody, signature)) {
    console.error('[WEBHOOK] Invalid or missing Paystack signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: PaystackEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  try {
    switch (event.event) {
      case 'charge.success': {
        const reference = event.data?.reference;
        if (!reference) {
          return NextResponse.json({ received: true });
        }

        const payment = await prisma.payment.findUnique({
          where: { reference },
        });

        // Not one of our payments — acknowledge so Paystack stops retrying
        if (!payment) {
          return NextResponse.json({ received: true });
        }

        // Idempotent: already confirmed, nothing to do
        if (payment.status === 'SUCCESSFUL') {
          return NextResponse.json({ received: true });
        }

        // 2. Re-verify against Paystack API — never trust the event payload
        const verification = await verifyTransaction(reference);
        const tx = verification.data;

        if (tx.status !== 'success') {
          // Event was premature or stale; let Paystack retry / callback handle it
          return NextResponse.json({ received: true });
        }

        if (tx.currency !== 'NGN') {
          logAudit({
            userId: payment.userId,
            action: 'payment.amount_mismatch',
            entity: 'Payment',
            entityId: payment.id,
            details: { reason: 'currency_mismatch', currency: tx.currency },
          }).catch(() => {});
          return NextResponse.json({ received: true });
        }

        // Amount tamper protection — must match server-calculated total
        const expectedAmountInKobo = Math.round(payment.totalAmount * 100);
        if (tx.amount !== expectedAmountInKobo) {
          logAudit({
            userId: payment.userId,
            action: 'payment.amount_mismatch',
            entity: 'Payment',
            entityId: payment.id,
            details: {
              expected: expectedAmountInKobo,
              received: tx.amount,
              source: 'webhook',
            },
          }).catch(() => {});
          return NextResponse.json({ received: true });
        }

        // 3. Idempotent state transition — re-read then update atomically
        const updated = await prisma.payment.updateMany({
          where: { id: payment.id, status: { not: 'SUCCESSFUL' } },
          data: {
            status: 'SUCCESSFUL',
            paystackReference: String(tx.id),
            paidAt: new Date(tx.paid_at),
          },
        });

        if (updated.count > 0) {
          await prisma.trip.update({
            where: { id: payment.tripId },
            data: {
              appCharge: payment.appCharge,
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
              appCharge: payment.appCharge,
              paystackTransactionId: tx.id,
              source: 'webhook',
            },
          }).catch(() => {});
        }

        return NextResponse.json({ received: true });
      }

      case 'charge.failed':
      case 'charge.failure': {
        const reference = event.data?.reference;
        if (!reference) {
          return NextResponse.json({ received: true });
        }

        const payment = await prisma.payment.findUnique({
          where: { reference },
        });

        if (!payment || payment.status === 'SUCCESSFUL') {
          // Never downgrade a confirmed payment
          return NextResponse.json({ received: true });
        }

        await prisma.payment.updateMany({
          where: { id: payment.id, status: 'PENDING' },
          data: {
            status: 'FAILED',
            failureReason:
              event.data?.gateway_response || 'Payment was not successful',
          },
        });

        logAudit({
          userId: payment.userId,
          action: 'payment.failed',
          entity: 'Payment',
          entityId: payment.id,
          details: {
            reference,
            source: 'webhook',
            event: event.event,
          },
        }).catch(() => {});

        return NextResponse.json({ received: true });
      }

      default:
        // Acknowledge all other events (deduction.success, etc.)
        return NextResponse.json({ received: true });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook failed';
    console.error('[WEBHOOK] Error:', message);

    // 5xx → Paystack retries later (transient DB/API failures recover)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

// Paystack only POSTs — reject other methods
export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
