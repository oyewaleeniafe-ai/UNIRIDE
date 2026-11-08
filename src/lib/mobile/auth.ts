/**
 * Mobile session tokens for the CampusCab native app.
 *
 * The website authenticates with next-auth cookies. React Native cannot rely on
 * those cookies, so the mobile API issues its own signed token (HS256 JWT) that
 * the app stores in the device's secure keystore and sends as
 * `Authorization: Bearer <token>`.
 *
 * The token only carries the user id. Every request re-reads the user (and its
 * student/driver row) from the database, so a role change, deactivation or
 * deleted profile takes effect immediately and a tampered/forged token cannot
 * escalate privileges.
 */

import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '@/lib/prisma';

const TOKEN_TTL = '30d';
const ISSUER = 'campuscab-mobile';
const AUDIENCE = 'campuscab-app';

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET is not configured on the server');
  }
  return new TextEncoder().encode(secret);
}

export type MobileAccount = {
  id: string;
  email: string;
  name: string;
  phone: string;
  role: 'STUDENT' | 'DRIVER' | 'ADMIN';
  profileImage: string | null;
  studentId: string | null;
  driverId: string | null;
  matricNo: string | null;
  university: string | null;
  driverCode: string | null;
};

export async function signMobileToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(TOKEN_TTL)
    .sign(secretKey());
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim() || null;
}

/** Resolve the account behind a bearer token, or null when it is not valid. */
export async function accountFromRequest(request: Request): Promise<MobileAccount | null> {
  const token = bearerToken(request);
  if (!token) return null;

  let userId: string;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    userId = payload.sub;
  } catch {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { student: true, driver: true },
  });

  // Deactivated or deleted accounts are rejected even if the token is valid.
  if (!user || !user.isActive) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: user.role,
    profileImage: user.profileImage,
    studentId: user.student?.id ?? null,
    driverId: user.driver?.id ?? null,
    matricNo: user.student?.matricNo ?? null,
    university: user.student?.university ?? null,
    driverCode: user.driver?.driverId ?? null,
  };
}
