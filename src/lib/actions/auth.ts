'use server';

import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { loginSchema, registerStudentSchema, registerDriverSchema, forgotPasswordIdentifySchema, forgotPasswordVerifySchema, forgotPasswordResetSchema } from '@/lib/validations';
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

// ─── Login ───────────────────────────────────────────

export async function loginUser(data: { email: string; password: string }) {
  const parsed = loginSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Please provide the required login information.',
      errors: {
        email: parsed.error.issues.find((i) => i.path.includes('email'))?.message,
        password: parsed.error.issues.find((i) => i.path.includes('password'))?.message,
      },
    };
  }

  const user = await prisma.user.findUnique({ where: { email: data.email.trim() } });

  if (!user || !user.isActive) {
    return {
      success: false,
      code: 'ACCOUNT_NOT_FOUND',
      message: 'Unable to log in with the provided credentials.',
    };
  }

  const isValid = await bcrypt.compare(data.password, user.passwordHash);
  if (!isValid) {
    return {
      success: false,
      code: 'INVALID_PASSWORD',
      message: 'Incorrect password.',
    };
  }

  return {
    success: true,
    code: 'LOGIN_SUCCESS',
    message: 'Login successful.',
    data: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role.toLowerCase(),
      },
    },
  };
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
    return { success: false, code: 'RECOVERY_UNAVAILABLE', error: 'Too many attempts. Please try again shortly.' };
  }

  const parsed = forgotPasswordIdentifySchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, code: 'VALIDATION_ERROR', error: parsed.error.issues[0].message };
  }

  const user = await prisma.user.findUnique({ where: { email: data.email.trim() } });

  if (!user || !user.passwordHintQuestion) {
    return {
      success: true,
      code: 'RECOVERY_ACCOUNT_FOUND',
      hintQuestion: 'What is your favorite food?',
      message: 'If an account exists, answer the question below to verify your identity.',
    };
  }

  return {
    success: true,
    code: 'RECOVERY_ACCOUNT_FOUND',
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
    return { success: false, code: 'RECOVERY_UNAVAILABLE', error: 'Too many attempts. Please try again shortly.' };
  }

  const parsed = forgotPasswordVerifySchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, code: 'VALIDATION_ERROR', error: parsed.error.issues[0].message };
  }

  const user = await prisma.user.findUnique({ where: { email: data.email.trim() } });

  if (!user || !user.passwordHintAnswer) {
    return { success: false, code: 'INVALID_HINT_ANSWER', error: 'Incorrect answer. Please try again.' };
  }

  const answerMatches = await bcrypt.compare(
    data.hintAnswer.trim().toLowerCase(),
    user.passwordHintAnswer
  );

  if (!answerMatches) {
    return { success: false, code: 'INVALID_HINT_ANSWER', error: 'Incorrect answer. Please try again.' };
  }

  // Invalidate any previous unused tokens
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  // Generate a reset token (10 minutes)
  const crypto = await import('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

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
    code: 'HINT_VERIFIED',
    resetToken: token,
    expiresInSeconds: 600,
    message: 'Identity verified.',
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
    return { success: false, code: 'PASSWORD_RESET_ERROR', error: 'Too many attempts. Please try again shortly.' };
  }

  const parsed = forgotPasswordResetSchema.safeParse(data);
  if (!parsed.success) {
    const isMismatch = parsed.error.issues.some((i) => i.path.includes('confirmPassword'));
    return {
      success: false,
      code: isMismatch ? 'PASSWORD_MISMATCH' : 'PASSWORD_VALIDATION_ERROR',
      error: parsed.error.issues[0].message,
    };
  }

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token: data.resetToken },
  });

  if (!resetToken || resetToken.usedAt) {
    return { success: false, code: 'INVALID_RESET_TOKEN', error: 'This password reset request is invalid. Please start the recovery process again.' };
  }

  if (new Date() > resetToken.expiresAt) {
    return { success: false, code: 'RESET_TOKEN_EXPIRED', error: 'This password reset request has expired. Please start the recovery process again.' };
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

  return { success: true, code: 'PASSWORD_RESET_SUCCESS', message: 'Your password has been changed successfully.' };
}
