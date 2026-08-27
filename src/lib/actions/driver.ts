'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export async function toggleDriverOnline(online: boolean) {
  const session = await auth();
  if (!session?.user) {
    return { error: 'You must be logged in.' };
  }

  const driver = await prisma.driver.findUnique({
    where: { userId: session.user.id },
    include: { inspections: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });

  if (!driver) {
    return { error: 'Driver account not found.' };
  }

  if (online) {
    const latestInspection = driver.inspections[0];
    if (!latestInspection || latestInspection.status !== 'COMPLETED') {
      return { error: 'Complete your vehicle inspection before going online.' };
    }
  }

  const updated = await prisma.driver.update({
    where: { id: driver.id },
    data: { isOnline: online },
  });

  return { success: true, isOnline: updated.isOnline };
}

export async function submitInspection(data: {
  brakes: boolean;
  tires: boolean;
  lights: boolean;
  interiorClean: boolean;
  noTrash: boolean;
  fireExtinguisher: boolean;
  firstAidKit: boolean;
  fuelBattery: boolean;
}) {
  const session = await auth();
  if (!session?.user) {
    return { error: 'You must be logged in.' };
  }

  const driver = await prisma.driver.findUnique({
    where: { userId: session.user.id },
  });

  if (!driver) {
    return { error: 'Driver account not found.' };
  }

  const allPassed =
    data.brakes && data.tires && data.lights && data.interiorClean &&
    data.noTrash && data.fireExtinguisher && data.firstAidKit && data.fuelBattery;

  const inspection = await prisma.vehicleInspection.create({
    data: {
      driverId: driver.id,
      brakes: data.brakes,
      tires: data.tires,
      lights: data.lights,
      interiorClean: data.interiorClean,
      noTrash: data.noTrash,
      fireExtinguisher: data.fireExtinguisher,
      firstAidKit: data.firstAidKit,
      fuelBattery: data.fuelBattery,
      status: allPassed ? 'COMPLETED' : 'DRAFT',
    },
  });

  return { success: true, inspection };
}
