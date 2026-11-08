import { loginUser } from '@/lib/actions/auth';
import { prisma } from '@/lib/prisma';
import { signMobileToken } from '@/lib/mobile/auth';
import { fail, json, limit, readJson } from '@/lib/mobile/http';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/** Sign in from the native app and receive a bearer token. */
export async function POST(request: Request) {
  const blocked = limit(request, RATE_LIMITS.login, 'mobile-login');
  if (blocked) return blocked;

  const body = await readJson<{ email?: string; password?: string }>(request);
  if (!body?.email || !body?.password) {
    return fail('Enter your email and password.', 400);
  }

  // Reuse the website's authentication logic so credentials, rate limits and
  // error messages stay identical across web and mobile.
  const result = await loginUser({ email: body.email, password: body.password });

  if (!result.success) {
    return fail(result.message ?? 'Unable to sign in.', 401, { code: result.code });
  }

  const user = await prisma.user.findUnique({ where: { email: body.email.trim() } });
  if (!user || !user.isActive) return fail('Unable to sign in.', 401);

  const token = await signMobileToken(user.id);

  return json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
    },
  });
}
