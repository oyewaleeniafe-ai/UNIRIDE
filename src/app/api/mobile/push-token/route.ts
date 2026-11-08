import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { fail, json, readJson, requireAccount } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/**
 * Register this device for push notifications.
 *
 * Tokens are stored on the existing PushToken table; the same token can move
 * between accounts when a device is reused, so it is reassigned rather than
 * duplicated.
 */
export async function POST(request: Request) {
  const account = await requireAccount(request);
  if (account instanceof NextResponse) return account;

  const body = await readJson<{ token?: string; platform?: string }>(request);
  const token = body?.token?.trim();
  if (!token) return fail('Push token is required.', 400);

  const platform = body?.platform === 'ios' ? 'ios' : body?.platform === 'android' ? 'android' : null;
  if (!platform) return fail('platform must be android or ios.', 400);

  const saved = await prisma.pushToken.upsert({
    where: { token },
    update: { userId: account.id, platform, isActive: true, lastUsedAt: new Date() },
    create: { userId: account.id, token, platform, isActive: true },
  });

  return json({ success: true, id: saved.id });
}

/** Unregister a token (called on sign-out). */
export async function DELETE(request: Request) {
  const account = await requireAccount(request);
  if (account instanceof NextResponse) return account;

  const body = await readJson<{ token?: string }>(request);
  if (!body?.token) return fail('Push token is required.', 400);

  await prisma.pushToken.updateMany({
    where: { token: body.token, userId: account.id },
    data: { isActive: false },
  });

  return json({ success: true });
}
