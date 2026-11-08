import { registerDriver, registerStudent } from '@/lib/actions/auth';
import { prisma } from '@/lib/prisma';
import { signMobileToken } from '@/lib/mobile/auth';
import { fail, json, limit, readJson } from '@/lib/mobile/http';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Register a student or driver from the app.
 *
 * The website's registration actions are reused unchanged, so validation,
 * duplicate checks and password hashing behave exactly as they do on web.
 * A token is returned so the new account is signed in immediately.
 */
export async function POST(request: Request) {
  const blocked = limit(request, RATE_LIMITS.register, 'mobile-register');
  if (blocked) return blocked;

  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return fail('Invalid request body.', 400);

  const role = body.role === 'DRIVER' ? 'DRIVER' : body.role === 'STUDENT' ? 'STUDENT' : null;
  if (!role) return fail('Choose whether you are a student or a driver.', 400);

  const result =
    role === 'STUDENT'
      ? await registerStudent(body as Parameters<typeof registerStudent>[0])
      : await registerDriver(body as Parameters<typeof registerDriver>[0]);

  if ('error' in result && result.error) {
    return fail(result.error ?? 'Request failed.', 400);
  }
  if (!('userId' in result) || !result.userId) {
    return fail('Registration failed. Please try again.', 400);
  }

  const user = await prisma.user.findUnique({ where: { id: result.userId } });
  if (!user) return fail('Registration failed. Please try again.', 400);

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
