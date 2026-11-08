import {
  forgotPasswordIdentify,
  forgotPasswordReset,
  forgotPasswordVerify,
} from '@/lib/actions/auth';
import { fail, json, limit, readJson } from '@/lib/mobile/http';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Password recovery in three steps, matching the website:
 *  1. identify — look up the account's security question
 *  2. verify   — answer the question, receive a short-lived reset token
 *  3. reset    — set a new password with that token
 */
export async function POST(request: Request) {
  const blocked = limit(request, RATE_LIMITS.passwordReset, 'mobile-recover');
  if (blocked) return blocked;

  const body = await readJson<{ step?: string; [key: string]: unknown }>(request);
  if (!body?.step) return fail('Missing recovery step.', 400);

  if (body.step === 'identify') {
    const result = await forgotPasswordIdentify({ email: String(body.email ?? '') });
    if (result.success === false) return fail(result.error ?? 'Unable to start recovery.', 400);
    return json(result);
  }

  if (body.step === 'verify') {
    const result = await forgotPasswordVerify({
      email: String(body.email ?? ''),
      hintAnswer: String(body.hintAnswer ?? ''),
    });
    if (result.success === false) return fail(result.error ?? 'Incorrect answer.', 400);
    return json(result);
  }

  if (body.step === 'reset') {
    const result = await forgotPasswordReset({
      resetToken: String(body.resetToken ?? ''),
      password: String(body.password ?? ''),
      confirmPassword: String(body.confirmPassword ?? ''),
    });
    if (result.success === false) return fail(result.error ?? 'Unable to reset password.', 400);
    return json(result);
  }

  return fail('Unknown recovery step.', 400);
}
