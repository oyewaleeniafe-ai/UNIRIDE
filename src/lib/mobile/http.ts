/**
 * Small helpers shared by the mobile JSON API routes.
 *
 * Every mobile route answers JSON (never redirects), validates its body with
 * zod, and rate-limits per client IP using the app's existing limiter.
 */

import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, type RateLimitConfig } from '@/lib/rate-limit';
import { accountFromRequest, type MobileAccount } from '@/lib/mobile/auth';

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

export function fail(error: string, status = 400, extra?: Record<string, unknown>) {
  return json({ error, ...(extra ?? {}) }, status);
}

/** Apply a rate limit; returns a response when the caller should stop. */
export function limit(request: Request, config: RateLimitConfig, scope: string) {
  const id = getClientIp(request.headers);
  const result = checkRateLimit(`${scope}:${id}`, config);
  if (!result.allowed) {
    return fail('Too many requests. Please try again in a moment.', 429);
  }
  return null;
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Require a valid mobile session, optionally restricted to given roles.
 * Role comes from the database row, never from the request body or token.
 *
 * Returns the account, or the error response to send back. Callers narrow with
 * `instanceof NextResponse`:
 *
 *   const account = await requireAccount(request, ['DRIVER']);
 *   if (account instanceof NextResponse) return account;
 */
export async function requireAccount(
  request: Request,
  roles?: Array<'STUDENT' | 'DRIVER' | 'ADMIN'>
): Promise<MobileAccount | NextResponse> {
  const account = await accountFromRequest(request);
  if (!account) return fail('Please sign in to continue.', 401);
  if (roles && !roles.includes(account.role)) {
    return fail('You do not have access to this resource.', 403);
  }
  return account;
}
