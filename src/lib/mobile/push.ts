/**
 * Expo push delivery for the native app.
 *
 * The mobile app registers its Expo push token through /api/mobile/push-token,
 * which is stored on the existing PushToken table (platform "android" or
 * "ios"). Sending is best-effort: push failures must never fail a ride action.
 *
 * No secrets are involved — the Expo push service is keyless for basic
 * notifications. If a project later enables enhanced security, set
 * EXPO_ACCESS_TOKEN and it is attached automatically.
 */

import { prisma } from '@/lib/prisma';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound: 'default';
  priority: 'high';
};

function isExpoToken(token: string): boolean {
  return token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[');
}

export async function sendExpoPushToUsers(
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (userIds.length === 0) return;

  try {
    const rows = await prisma.pushToken.findMany({
      where: { userId: { in: userIds }, isActive: true, platform: { in: ['android', 'ios'] } },
      select: { token: true },
    });

    const tokens = [...new Set(rows.map((row) => row.token))].filter(isExpoToken);
    if (tokens.length === 0) return;

    const messages: PushMessage[] = tokens.map((token) => ({
      to: token,
      title,
      body,
      ...(data ? { data } : {}),
      sound: 'default',
      priority: 'high',
    }));

    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(process.env.EXPO_ACCESS_TOKEN
          ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(messages),
      // Never let a slow push provider hold up a ride action.
      signal: AbortSignal.timeout(6000),
    });
  } catch (error) {
    console.error('[PUSH] delivery failed', error instanceof Error ? error.message : error);
  }
}

export function sendExpoPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  return sendExpoPushToUsers([userId], title, body, data);
}
