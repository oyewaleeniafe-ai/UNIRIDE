import { NextResponse } from 'next/server';
import { fail, json, readJson, requireAccount } from '@/lib/mobile/http';
import { markNotification, notificationsFor } from '@/lib/mobile/service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const account = await requireAccount(request);
  if (account instanceof NextResponse) return account;

  const result = await notificationsFor(account);
  return json(result);
}

/** body: { id: string | 'all' } — mark one or every notification as read. */
export async function POST(request: Request) {
  const account = await requireAccount(request);
  if (account instanceof NextResponse) return account;

  const body = await readJson<{ id?: string }>(request);
  if (!body?.id) return fail('id is required.', 400);

  const result = await markNotification(account, body.id);
  if ('error' in result) return fail(result.error ?? 'Request failed.', 404);
  return json(result);
}
