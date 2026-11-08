import { NextResponse } from 'next/server';
import { fail, json, limit, readJson, requireAccount } from '@/lib/mobile/http';
import { createTrip, listTrips } from '@/lib/mobile/service';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** GET /api/mobile/trips?scope=active|history */
export async function GET(request: Request) {
  const account = await requireAccount(request, ['STUDENT', 'DRIVER']);
  if (account instanceof NextResponse) return account;

  const scope = new URL(request.url).searchParams.get('scope') === 'history' ? 'history' : 'active';
  const trips = await listTrips(account, scope);
  return json({ trips });
}

/** POST /api/mobile/trips — book a ride (fare is calculated server-side). */
export async function POST(request: Request) {
  const account = await requireAccount(request, ['STUDENT']);
  if (account instanceof NextResponse) return account;

  const blocked = limit(request, RATE_LIMITS.booking, 'mobile-booking');
  if (blocked) return blocked;

  const body = await readJson(request);
  if (!body) return fail('Invalid request body.', 400);

  const result = await createTrip(account, body);
  if ('error' in result) return fail(result.error ?? 'Request failed.', 400);
  return json({ trip: result.trip }, 201);
}
