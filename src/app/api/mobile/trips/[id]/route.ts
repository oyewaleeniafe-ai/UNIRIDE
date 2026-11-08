import { NextResponse } from 'next/server';
import { fail, json, limit, readJson, requireAccount } from '@/lib/mobile/http';
import {
  acceptRide,
  cancelRide,
  completeRide,
  getTrip,
  rateTrip,
  startRide,
} from '@/lib/mobile/service';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const account = await requireAccount(request);
  if (account instanceof NextResponse) return account;

  const { id } = await params;
  const result = await getTrip(account, id);
  if ('error' in result) return fail(result.error ?? 'Request failed.', 404);
  return json({ trip: result.trip });
}

/**
 * Ride lifecycle. Role enforcement lives in the service layer and is based on
 * the database role, not on anything the app sends.
 *
 * body: { action: 'accept' | 'start' | 'complete' | 'cancel' | 'rate' }
 */
export async function POST(request: Request, { params }: Params) {
  const account = await requireAccount(request);
  if (account instanceof NextResponse) return account;

  const { id } = await params;
  const body = await readJson<{ action?: string; score?: number; feedback?: string }>(request);
  if (!body?.action) return fail('Missing action.', 400);

  switch (body.action) {
    case 'accept':
      return respond(await acceptRide(account, id));
    case 'start':
      return respond(await startRide(account, id));
    case 'complete':
      return respond(await completeRide(account, id));
    case 'cancel':
      return respond(await cancelRide(account, id));
    case 'rate': {
      const blocked = limit(request, RATE_LIMITS.rating, 'mobile-rating');
      if (blocked) return blocked;
      return respond(await rateTrip(account, id, Number(body.score), body.feedback));
    }
    default:
      return fail('Unknown action.', 400);
  }
}

function respond(result: { error: string } | { trip: unknown } | { success: boolean }) {
  if ('error' in result) return fail(result.error ?? 'Request failed.', 400);
  if ('trip' in result) return json({ trip: result.trip });
  return json(result);
}
