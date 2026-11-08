import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { fail, json, readJson, requireAccount } from '@/lib/mobile/http';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

/** The signed-in user's profile, used to restore a session on app launch. */
export async function GET(request: Request) {
  const account = await requireAccount(request);
  if (account instanceof NextResponse) return account;

  const user = await prisma.user.findUnique({
    where: { id: account.id },
    include: {
      student: true,
      driver: { include: { vehicle: true, inspections: { orderBy: { createdAt: 'desc' }, take: 1 } } },
    },
  });
  if (!user) return fail('Account not found.', 404);

  return json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      profileImage: user.profileImage,
      createdAt: user.createdAt.toISOString(),
    },
    student: user.student
      ? { matricNo: user.student.matricNo, university: user.student.university }
      : null,
    driver: user.driver
      ? {
          driverCode: user.driver.driverId,
          isOnline: user.driver.isOnline,
          rating: user.driver.avgRating,
          totalTrips: user.driver.totalTrips,
          vehicle: user.driver.vehicle
            ? {
                make: user.driver.vehicle.make,
                model: user.driver.vehicle.model,
                color: user.driver.vehicle.color,
                plate: user.driver.vehicle.licensePlate,
              }
            : null,
          inspectionStatus: user.driver.inspections[0]?.status ?? null,
        }
      : null,
  });
}

const profileInput = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80).optional(),
  phone: z.string().trim().min(10, 'Enter a valid phone number').max(20).optional(),
});

/** Update the account's own name / phone number. */
export async function PATCH(request: Request) {
  const account = await requireAccount(request);
  if (account instanceof NextResponse) return account;

  const body = await readJson<unknown>(request);
  const parsed = profileInput.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0].message, 400);
  if (!parsed.data.name && !parsed.data.phone) return fail('Nothing to update.', 400);

  const updated = await prisma.user.update({
    where: { id: account.id },
    data: {
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.phone ? { phone: parsed.data.phone } : {}),
    },
    select: { id: true, name: true, phone: true, email: true, role: true },
  });

  return json({ user: updated });
}

const passwordInput = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: z.string().min(8, 'Your new password must be at least 8 characters'),
});

/** Change the account password after confirming the current one. */
export async function POST(request: Request) {
  const account = await requireAccount(request);
  if (account instanceof NextResponse) return account;

  const body = await readJson<unknown>(request);
  const parsed = passwordInput.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0].message, 400);

  const user = await prisma.user.findUnique({ where: { id: account.id } });
  if (!user) return fail('Account not found.', 404);

  const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!valid) return fail('Your current password is incorrect.', 400);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 12) },
  });

  return json({ success: true });
}
