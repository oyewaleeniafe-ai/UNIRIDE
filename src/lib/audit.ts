import { prisma } from '@/lib/prisma';

export type AuditAction =
  // Trip actions
  | 'trip.created'
  | 'trip.accepted'
  | 'trip.started'
  | 'trip.completed'
  | 'trip.cancelled'
  // SOS actions
  | 'sos.triggered'
  | 'sos.acknowledged'
  | 'sos.resolved'
  // Auth actions
  | 'auth.login'
  | 'auth.register'
  | 'auth.logout'
  // Driver actions
  | 'driver.went_online'
  | 'driver.went_offline'
  | 'driver.inspection_submitted'
  // Rating actions
  | 'rating.submitted'
  // Generic
  | 'system.error';

interface AuditLogEntry {
  userId?: string;
  action: AuditAction;
  entity: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * Write an audit log entry. This is fire-and-forget — errors are swallowed
 * so audit logging never blocks the main operation.
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        details: entry.details ? JSON.parse(JSON.stringify(entry.details)) : undefined,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (err) {
    // Audit logging must never break the app
    console.error('[AUDIT] Failed to write audit log:', err);
  }
}

/**
 * Convenience: log a trip status change.
 */
export async function logTripStatusChange(data: {
  userId: string;
  tripId: string;
  action: AuditAction;
  from: string;
  to: string;
  driverId?: string;
  studentId?: string;
  fare?: number;
  pickup?: string;
  dropoff?: string;
}) {
  await logAudit({
    userId: data.userId,
    action: data.action,
    entity: 'Trip',
    entityId: data.tripId,
    details: {
      from: data.from,
      to: data.to,
      driverId: data.driverId,
      studentId: data.studentId,
      fare: data.fare,
      pickup: data.pickup,
      dropoff: data.dropoff,
    },
  });
}

/**
 * Convenience: log a safety alert event.
 */
export async function logSOSAlert(data: {
  userId: string;
  alertId: string;
  action: AuditAction;
  tripId?: string;
  latitude?: number;
  longitude?: number;
}) {
  await logAudit({
    userId: data.userId,
    action: data.action,
    entity: 'SafetyAlert',
    entityId: data.alertId,
    details: {
      tripId: data.tripId,
      latitude: data.latitude,
      longitude: data.longitude,
    },
  });
}

/**
 * Convenience: log an auth event.
 */
export async function logAuthEvent(data: {
  userId?: string;
  action: AuditAction;
  email?: string;
  role?: string;
}) {
  await logAudit({
    userId: data.userId,
    action: data.action,
    entity: 'User',
    entityId: data.userId,
    details: {
      email: data.email,
      role: data.role,
    },
  });
}

/**
 * Get recent audit logs with user info.
 */
export async function getAuditLogs(options?: {
  entity?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}) {
  const where: Record<string, unknown> = {};
  if (options?.entity) where.entity = options.entity;
  if (options?.entityId) where.entityId = options.entityId;
  if (options?.userId) where.userId = options.userId;
  if (options?.action) where.action = options.action;

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: options?.limit ?? 50,
    skip: options?.offset ?? 0,
  });

  return logs;
}
