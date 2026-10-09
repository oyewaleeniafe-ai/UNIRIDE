import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleWebhookProvider } from '@/lib/payments';
import { logAudit } from '@/lib/audit';
import type { Provider } from '@/lib/payments';

/**
 * Payment webhook receiver for PalmPay and OPay.
 *
 * Security model:
 *  1. Signature verification per provider (HMAC-SHA256 of the raw body).
 *  2. Idempotent processing — duplicate deliveries never double-pay, double-payout,
 *     or double-complete a trip.
 *  3. Payment status changes are applied by the provider facade, which also rederives
 *     trip earnings from the server-side payment record.
 *
 * IMPORTANT: provider-specific signature header names and algorithms must match
 * PalmPay and OPay's official documentation. If either provider requires a different
 * header or method, update the adapter modules and the header routing below.
 */

export const runtime = 'nodejs';

async function rawBody(request: NextRequest): Promise<string> {
  return request.text();
}

function providerFromHeader(headers: Headers): Provider | null {
  const xProvider = headers.get('x-payment-provider');
  if (xProvider?.toUpperCase() === 'PALMPAY') return 'PALMPAY';
  if (xProvider?.toUpperCase() === 'OPAY') return 'OPAY';

  // Fallback heuristic: use the signature header name if no explicit provider header.
  // TODO before production: require an explicit provider header in production once
  // both providers are live, so webhook routing is unambiguous.
  if (headers.has('x-palmpay-signature')) return 'PALMPAY';
  if (headers.has('x-opay-signature')) return 'OPAY';
  return null;
}

export async function POST(request: NextRequest) {
  const body = await rawBody(request);
  const headers = request.headers;

  const provider = providerFromHeader(headers);
  if (!provider) {
    console.error('[WEBHOOK] Unknown provider — no x-payment-provider header and no recognizable signature header');
    return NextResponse.json({ error: 'Unknown payment provider' }, { status: 400 });
  }

  const signature =
    provider === 'PALMPAY'
      ? headers.get('x-palmpay-signature')
      : headers.get('x-opay-signature');

  try {
    const processed = await handleWebhookProvider(provider, {
      provider,
      rawBody: body,
      signatureHeader: signature ?? undefined,
    });

    if (!processed) {
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook processing failed';
    console.error(`[WEBHOOK] ${provider} error:`, message);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
