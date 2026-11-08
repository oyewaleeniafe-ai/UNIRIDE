import { NextResponse } from 'next/server';
import { fail, json, requireAccount } from '@/lib/mobile/http';
import { driverEarnings } from '@/lib/mobile/service';

export const dynamic = 'force-dynamic';

/** Earnings, payout history and the saved bank account. */
export async function GET(request: Request) {
  const account = await requireAccount(request, ['DRIVER']);
  if (account instanceof NextResponse) return account;

  const result = await driverEarnings(account);
  if ('error' in result) return fail(result.error ?? 'Request failed.', 404);
  return json(result);
}
