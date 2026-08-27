'use server';

import { prisma } from '@/lib/prisma';
import { auth, getUserId } from '@/lib/auth';
import { sendSOSAlertEmail, sendSOSConfirmationEmail } from '@/lib/email';
import { logAudit, logSOSAlert } from '@/lib/audit';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { headers } from 'next/headers';

async function getRateLimitId(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || h.get('cf-connecting-ip') || 'unknown';
}

export async function submitRating(data: {
  tripId: string;
  score: number;
  feedback?: string;
}) {
  const userId = await getUserId();

  const trip = await prisma.trip.findUnique({ where: { id: data.tripId } });
  if (!trip) return { error: 'Trip not found.' };
  if (trip.status !== 'COMPLETED') return { error: 'Can only rate completed trips.' };
  if (trip.studentId !== userId) return { error: 'You can only rate your own trips.' };
  if (!trip.driverId) return { error: 'No driver assigned to this trip.' };

  const existing = await prisma.rating.findFirst({
    where: { tripId: data.tripId, userId },
  });
  if (existing) return { error: 'You have already rated this trip.' };
  if (data.score < 1 || data.score > 5) return { error: 'Rating must be between 1 and 5.' };

  const rating = await prisma.rating.create({
    data: {
      tripId: data.tripId,
      driverId: trip.driverId,
      userId,
      score: data.score,
      feedback: data.feedback,
    },
  });

  const stats = await prisma.rating.aggregate({
    where: { driverId: trip.driverId },
    _avg: { score: true },
  });

  await prisma.driver.update({
    where: { id: trip.driverId },
    data: { avgRating: stats._avg.score ?? 0 },
  });

  // Audit log
  logAudit({
    userId,
    action: 'rating.submitted',
    entity: 'Rating',
    entityId: rating.id,
    details: {
      tripId: data.tripId,
      driverId: trip.driverId,
      score: data.score,
      hasFeedback: !!data.feedback,
    },
  }).catch(() => {});

  return { success: true, rating };
}

export async function getLocations() {
  return await prisma.campusLocation.findMany({ orderBy: { name: 'asc' } });
}

export async function getNotifications() {
  const session = await auth();
  if (!session?.user) return { notifications: [] };

  const notifications = await prisma.notification.findMany({
    where: { userId: await getUserId() },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return { notifications };
}

export async function markNotificationRead(id: string) {
  await prisma.notification.update({ where: { id }, data: { isRead: true } });
  return { success: true };
}

export async function sendSOS(data: { latitude?: number; longitude?: number; notes?: string }) {
  const rateLimitId = await getRateLimitId();
  const limit = checkRateLimit(rateLimitId, RATE_LIMITS.sos);
  if (!limit.allowed) {
    return { error: 'Too many SOS requests. Please try again later.' };
  }

  const userId = await getUserId();

  const activeTrip = await prisma.trip.findFirst({
    where: { studentId: userId, status: { in: ['ACCEPTED', 'IN_PROGRESS'] } },
    include: { pickupLocation: true, dropoffLocation: true },
  });

  const alert = await prisma.safetyAlert.create({
    data: {
      userId,
      tripId: activeTrip?.id ?? null,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      notes: data.notes ?? null,
      status: 'PENDING',
    },
  });

  // Audit log (non-blocking)
  logSOSAlert({
    userId,
    alertId: alert.id,
    action: 'sos.triggered',
    tripId: activeTrip?.id ?? undefined,
    latitude: data.latitude,
    longitude: data.longitude,
  }).catch(() => {});

  // Send SOS email alerts (non-blocking)
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const securityEmail = process.env.SOS_SECURITY_EMAIL || 'security@campuscab.app';

  if (user?.email) {
    // Alert campus security
    sendSOSAlertEmail({
      to: securityEmail,
      userName: user.name,
      userEmail: user.email,
      pickup: activeTrip?.pickupLocation?.name,
      dropoff: activeTrip?.dropoffLocation?.name,
      latitude: data.latitude,
      longitude: data.longitude,
      timestamp: new Date().toLocaleString(),
    }).catch(() => {});

    // Confirmation to the user
    sendSOSConfirmationEmail({
      to: user.email,
      userName: user.name,
    }).catch(() => {});
  }

  return { success: true, alert };
}

export async function getAuditLogs(options?: {
  entity?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}) {
  const session = await auth();
  if (!session?.user) return { logs: [] };

  const logs = await prisma.auditLog.findMany({
    where: {
      ...(options?.entity ? { entity: options.entity } : {}),
      ...(options?.entityId ? { entityId: options.entityId } : {}),
      ...(options?.userId ? { userId: options.userId } : {}),
      ...(options?.action ? { action: options.action } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: options?.limit ?? 50,
    skip: options?.offset ?? 0,
  });

  return { logs };
}
