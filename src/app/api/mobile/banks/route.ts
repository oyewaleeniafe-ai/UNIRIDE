import { NIGERIAN_BANKS } from '@/lib/payments/banks';
import { json } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** Banks supported for driver payouts (Flutterwave bank codes). */
export async function GET() {
  return json({ banks: NIGERIAN_BANKS });
}
