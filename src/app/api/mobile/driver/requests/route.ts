import { NextResponse } from 'next/server';
import { fail, json, requireAccount } from '@/lib/mobile/http';
import { availableRides } from '@/lib/mobile/service';

export const dynamic = 'force-dynamic';

/** Paid, unassigned rides waiting for a driver. */
export async function GET(request: Request) {
  const account = await requireAccount(request, ['DRIVER']);
  if (account instanceof NextResponse) return account;

  const result = await availableRides(account);
  if ('error' in result) return fail(result.error ?? 'Request failed.', 403);
  return json(result);
}
