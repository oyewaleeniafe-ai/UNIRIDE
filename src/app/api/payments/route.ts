import { NextRequest, NextResponse } from 'next/server';
import { initializePayment } from '@/lib/actions/payments';

export async function POST(request: NextRequest) {
  let body: { tripId?: string; provider?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const tripId = body.tripId;

  if (!tripId || typeof tripId !== 'string') {
    return NextResponse.json({ error: 'tripId is required' }, { status: 400 });
  }

  // CampusCab only supports Flutterwave. The provider field is accepted from
  // older clients for backward compatibility but ignored — it is always
  // Flutterwave internally.
  const result = await initializePayment(tripId);

  if (result.error) {
    const status = result.error.includes('logged in')
      ? 401
      : result.error.includes('already been paid')
        ? 409
        : 400;
    return NextResponse.json({ error: result.error }, { status });
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
