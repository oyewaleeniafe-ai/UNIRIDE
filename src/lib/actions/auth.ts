'use server';

import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { registerStudentSchema, registerDriverSchema } from '@/lib/validations';
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
