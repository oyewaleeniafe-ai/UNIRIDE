import { NextRequest, NextResponse } from 'next/server';
import { initializePayment } from '@/lib/actions/payments';
import type { Provider } from '@/lib/payments';

export async function POST(request: NextRequest) {
  let body: { tripId?: string; provider?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const tripId = body.tripId;
  const provider = body.provider?.toUpperCase();

  if (!tripId || typeof tripId !== 'string') {
    return NextResponse.json({ error: 'tripId is required' }, { status: 400 });
  }

  if (!provider || (!provider.startsWith('PALMPAY') && provider !== 'OPAY')) {
    return NextResponse.json({ error: 'Valid provider is required (PALMPAY or OPAY)' }, { status: 400 });
  }

  const result = await initializePayment(tripId, provider as Provider);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.paymentId && result.providerReference ? 409 : 400 });
  }

  if (!result.success) {
    return NextResponse.json({ error: result.error ?? 'Payment initialization failed' }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    checkoutUrl: result.checkoutUrl ?? null,
    reference: result.reference ?? null,
    providerReference: result.providerReference ?? null,
    paymentId: result.paymentId ?? null,
    amount: result.amount ?? null,
    breakdown: result.breakdown ?? null,
  });
}
