import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleWebhookProvider } from '@/lib/payments';
import { FLUTTERWAVE_WEBHOOK_HEADER } from '@/lib/payments/types';
import { logAudit } from '@/lib/audit';

/**
 * Flutterwave webhook receiver.
 *
 * Security model:
 *  1. Signature verification via the verif-hash header against the dashboard
 *     secret hash (constant-time comparison).
 *  2. Idempotent processing — duplicate deliveries never double-pay, double-payout,
 *     or double-complete a trip.
 *  3. Payment status changes are applied by the Flutterwave adapter, which also
 *     re-verifies state against the Flutterwave API before acting.
 *
 * Docs: https://developer.flutterwave.com/docs/webhooks
 */
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const headers = request.headers;

  const signature = headers.get(FLUTTERWAVE_WEBHOOK_HEADER);

  // Reject anything that does not carry a valid Flutterwave webhook signature.
  const processed = await handleWebhookProvider({
    provider: 'FLUTTERWAVE',
    rawBody: body,
    signatureHeader: signature ?? undefined,
  });

  if (!processed) {
    console.error('[WEBHOOK] Invalid or missing Flutterwave verif-hash signature');
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
  }

  return NextResponse.json({ received: true });
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

