import { NextResponse } from 'next/server';
import { fail, json, limit, readJson, requireAccount } from '@/lib/mobile/http';
import { triggerSos } from '@/lib/mobile/service';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** Raise an SOS alert; the active ride is attached automatically. */
export async function POST(request: Request) {
  const account = await requireAccount(request);
  if (account instanceof NextResponse) return account;

  const blocked = limit(request, RATE_LIMITS.sos, 'mobile-sos');
  if (blocked) return blocked;

  const body = await readJson<{ latitude?: number; longitude?: number; notes?: string }>(request);

  const result = await triggerSos(account, {
    latitude: typeof body?.latitude === 'number' ? body.latitude : undefined,
    longitude: typeof body?.longitude === 'number' ? body.longitude : undefined,
    notes: typeof body?.notes === 'string' ? body.notes : undefined,
  });

  return json(result);
}
