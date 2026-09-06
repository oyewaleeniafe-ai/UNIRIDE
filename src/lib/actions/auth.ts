'use server';

import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { registerStudentSchema, registerDriverSchema, forgotPasswordIdentifySchema, forgotPasswordVerifySchema, forgotPasswordResetSchema } from '@/lib/validations';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { logAuthEvent } from '@/lib/audit';

async function getRateLimitId(): Promise<string> {
  const h = await headers();
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    h.get('cf-connecting-ip') ||
    'unknown'
  );
}

export async function registerStudent(data: {
  name: string;
  email: string;
  matricNo: string;
  phone: string;
  password: string;
  confirmPassword: string;
  hintQuestion: string;
  hintAnswer: string;
}) {
  const rateLimitId = await getRateLimitId();
  const limit = checkRateLimit(rateLimitId, RATE_LIMITS.register);
  if (!limit.allowed) {
    return { error: 'Too many registration attempts. Please try again later.' };
  }

  const parsed = registerStudentSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    return { error: 'An account with this email already exists.' };
  }

  const existingMatric = await prisma.student.findUnique({ where: { matricNo: data.matricNo } });
  if (existingMatric) {
    return { error: 'An account with this matric number already exists.' };
  }

  const passwordHash = await bcrypt.hash(data.password, 12);
  const hintAnswerHash = await bcrypt.hash(data.hintAnswer.trim().toLowerCase(), 10);

  const user = await prisma.user.create({
    data: {
      email: data.email,
      name: data.name,
      phone: data.phone,
      passwordHash,
      passwordHintQuestion: data.hintQuestion.trim(),
      passwordHintAnswer: hintAnswerHash,
      role: 'STUDENT',
      student: {
        create: {
          matricNo: data.matricNo,
        },
      },
    },
  });

  logAuthEvent({
    userId: user.id,
    action: 'auth.register',
    email: data.email,
    role: 'STUDENT',
  }).catch(() => {});

  return { success: true, userId: user.id };
}

export async function registerDriver(data: {
  name: string;
  email: string;
  driverId: string;
  phone: string;
  password: string;
  confirmPassword: string;
  hintQuestion: string;
  hintAnswer: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleColor: string;
  licensePlate: string;
}) {
  const rateLimitId = await getRateLimitId();
  const limit = checkRateLimit(rateLimitId, RATE_LIMITS.register);
  if (!limit.allowed) {
    return { error: 'Too many registration attempts. Please try again later.' };
  }

  const parsed = registerDriverSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    return { error: 'An account with this email already exists.' };
  }

  const existingDriverId = await prisma.driver.findUnique({ where: { driverId: data.driverId } });
  if (existingDriverId) {
    return { error: 'An account with this driver ID already exists.' };
  }

  const passwordHash = await bcrypt.hash(data.password, 12);
  const hintAnswerHash = await bcrypt.hash(data.hintAnswer.trim().toLowerCase(), 10);

  const user = await prisma.user.create({
    data: {
      email: data.email,
      name: data.name,
      phone: data.phone,
      passwordHash,
      passwordHintQuestion: data.hintQuestion.trim(),
      passwordHintAnswer: hintAnswerHash,
      role: 'DRIVER',
      driver: {
        create: {
          driverId: data.driverId,
          vehicle: {
            create: {
              make: data.vehicleMake,
              model: data.vehicleModel,
              color: data.vehicleColor,
              licensePlate: data.licensePlate,
            },
          },
        },
      },
    },
  });

  logAuthEvent({
    userId: user.id,
    action: 'auth.register',
    email: data.email,
    role: 'DRIVER',
  }).catch(() => {});

  return { success: true, userId: user.id };
}

// ─── Forgot / Reset Password (Hint-Based) ───────────

/**
 * Step 1: Look up user by email, return their hint question.
 * Does not reveal whether the account exists.
 */
export async function forgotPasswordIdentify(data: { email: string }) {
  const rateLimitId = await getRateLimitId();
  const limit = checkRateLimit(rateLimitId, RATE_LIMITS.passwordReset);
  if (!limit.allowed) {
    return { error: 'Too many attempts. Please try again shortly.' };
  }

  const parsed = forgotPasswordIdentifySchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const user = await prisma.user.findUnique({ where: { email: data.email.trim() } });

  // Generic message to prevent user enumeration
  if (!user || !user.passwordHintQuestion) {
    return {
      success: true,
      hintQuestion: 'What is your favorite color?',
      message: 'If an account exists, answer the question below to verify your identity.',
    };
  }

  return {
    success: true,
    hintQuestion: user.passwordHintQuestion,
    message: 'Answer the question below to verify your identity.',
  };
}

/**
 * Step 2: Verify the hint answer. If correct, return a short-lived reset token.
 */
export async function forgotPasswordVerify(data: { email: string; hintAnswer: string }) {
  const rateLimitId = await getRateLimitId();
  const limit = checkRateLimit(rateLimitId, RATE_LIMITS.passwordReset);
  if (!limit.allowed) {
    return { error: 'Too many attempts. Please try again shortly.' };
  }

  const parsed = forgotPasswordVerifySchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const user = await prisma.user.findUnique({ where: { email: data.email.trim() } });

  if (!user || !user.passwordHintAnswer) {
    return { error: 'Incorrect answer. Please try again.' };
  }

  // Compare with normalized input (lowercase, trimmed)
  const answerMatches = await bcrypt.compare(
    data.hintAnswer.trim().toLowerCase(),
    user.passwordHintAnswer
  );

  if (!answerMatches) {
    return { error: 'Incorrect answer. Please try again.' };
  }

  // Invalidate any previous unused tokens
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  // Generate a short-lived reset token (15 minutes)
  const crypto = await import('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      token,
      method: 'hint',
      contact: data.email.trim(),
      expiresAt,
    },
  });

  logAuthEvent({
    userId: user.id,
    action: 'auth.password_reset_request',
    email: user.email,
  }).catch(() => {});

  return {
    success: true,
    resetToken: token,
    message: 'Identity verified. You may now set a new password.',
  };
}

/**
 * Step 3: Reset the password using the token from step 2.
 */
export async function forgotPasswordReset(data: {
  resetToken: string;
  password: string;
  confirmPassword: string;
}) {
  const rateLimitId = await getRateLimitId();
  const limit = checkRateLimit(rateLimitId, RATE_LIMITS.passwordReset);
  if (!limit.allowed) {
    return { error: 'Too many attempts. Please try again shortly.' };
  }

  const parsed = forgotPasswordResetSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token: data.resetToken },
  });

  if (!resetToken || resetToken.usedAt) {
    return { error: 'Invalid or already-used reset token.' };
  }

  if (new Date() > resetToken.expiresAt) {
    return { error: 'Reset token has expired. Please start the recovery process again.' };
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
  ]);

  logAuthEvent({
    userId: resetToken.userId,
    action: 'auth.password_reset_complete',
  }).catch(() => {});

  return { success: true, message: 'Password reset successfully. You can now sign in.' };
}
