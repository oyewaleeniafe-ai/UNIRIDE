'use server';

import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { registerStudentSchema, registerDriverSchema, forgotPasswordSchema, resetPasswordSchema } from '@/lib/validations';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { logAuthEvent } from '@/lib/audit';
import { sendPasswordResetEmail } from '@/lib/email';

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

  const user = await prisma.user.create({
    data: {
      email: data.email,
      name: data.name,
      phone: data.phone,
      passwordHash,
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

  const user = await prisma.user.create({
    data: {
      email: data.email,
      name: data.name,
      phone: data.phone,
      passwordHash,
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

// ─── Forgot / Reset Password ─────────────────────────

export async function requestPasswordReset(data: { contact: string }) {
  const rateLimitId = await getRateLimitId();
  const limit = checkRateLimit(rateLimitId, RATE_LIMITS.passwordReset);
  if (!limit.allowed) {
    return { error: 'Too many reset attempts. Please try again in 15 minutes.' };
  }

  const parsed = forgotPasswordSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const contact = data.contact.trim();
  const isEmail = contact.includes('@');

  // Find user by email or phone
  const user = isEmail
    ? await prisma.user.findUnique({ where: { email: contact } })
    : await prisma.user.findFirst({ where: { phone: contact } });

  // Always return success to prevent user enumeration
  if (!user) {
    return {
      success: true,
      message: 'If an account exists with that email or phone, a reset code has been generated.',
    };
  }

  // Generate a secure random token
  const crypto = await import('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Invalidate any previous unused tokens for this user
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  // Create the new reset token
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      token,
      method: isEmail ? 'email' : 'phone',
      contact,
      expiresAt,
    },
  });

  logAuthEvent({
    userId: user.id,
    action: 'auth.password_reset_request',
    email: user.email,
  }).catch(() => {});

  // Send the reset email via Resend
  if (isEmail) {
    await sendPasswordResetEmail({
      to: contact,
      userName: user.name,
      token,
      expiresAt,
    });
  }

  // Always return the same message whether we sent email or not
  const channel = isEmail ? 'email' : 'phone';
  return {
    success: true,
    message: `If an account exists with that ${channel}, a reset link has been sent. Please check your ${channel}.`,
  };
}

export async function resetPassword(data: {
  token: string;
  password: string;
  confirmPassword: string;
}) {
  const rateLimitId = await getRateLimitId();
  const limit = checkRateLimit(rateLimitId, RATE_LIMITS.passwordReset);
  if (!limit.allowed) {
    return { error: 'Too many attempts. Please try again in 15 minutes.' };
  }

  const parsed = resetPasswordSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Find the token
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token: data.token },
  });

  if (!resetToken || resetToken.usedAt) {
    return { error: 'Invalid or already-used reset token.' };
  }

  if (new Date() > resetToken.expiresAt) {
    return { error: 'Reset token has expired. Please request a new one.' };
  }

  // Hash the new password
  const passwordHash = await bcrypt.hash(data.password, 12);

  // Update password and mark token as used in a transaction
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
