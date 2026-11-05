/**
 * Shared authorization helpers for commission APIs, server actions and pages.
 * Authorization is always enforced server-side — hidden UI is never the guard.
 */

import { auth } from '@/lib/auth';

export type SessionUser = {
  id: string;
  email: string | null;
  role: string;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = session?.user as any;
  if (!user?.id) return null;
  return {
    id: String(user.id),
    email: user.email ? String(user.email) : null,
    role: String(user.role ?? ''),
  };
}

export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === 'ADMIN';
}

export function isDriver(user: SessionUser | null): boolean {
  return user?.role === 'DRIVER';
}
