'use server';

import { prisma } from '@/lib/prisma';
import { auth, getUserId } from '@/lib/auth';
import { bookingSchema } from '@/lib/validations';
import { sendRideAcceptedEmail, sendRideStartedEmail, sendRideCompletedEmail, sendRideCancelledEmail } from '@/lib/email';
import { logAudit, logTripStatusChange } from '@/lib/audit';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { headers } from 'next/headers';

async function getRateLimitId(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || h.get('cf-connecting-ip') || 'unknown';
}

const FARE_PER_PASSENGER = 800;

export async function createTrip(data: {
  pickupLocationId: string;
  dropoffLocationId: string;
  passengerCount: number;
  rideType: 'SOLO_QUICK_CAB' | 'SHARED_SHUTTLE';
}) {
  const rateLimitId = await getRateLimitId();
  const limit = checkRateLimit(rateLimitId, RATE_LIMITS.booking);
  if (!limit.allowed) {
    return { error: 'Too many booking requests. Please try again later.' };
  }

  const session = await auth();
  if (!session?.user) {
    return { error: 'You must be logged in to book a ride.' };
  }

  const parsed = bookingSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  if (data.pickupLocationId === data.dropoffLocationId) {
    return { error: 'Pickup and drop-off locations must be different.' };
  }

  const pickup = await prisma.campusLocation.findUnique({ where: { id: data.pickupLocationId } });
  const dropoff = await prisma.campusLocation.findUnique({ where: { id: data.dropoffLocationId } });

  if (!pickup || !dropoff) {
    return { error: 'Invalid location selected.' };
  }

  const totalFare = data.passengerCount * FARE_PER_PASSENGER;
  const userId = await getUserId();

  const student = await prisma.student.findUnique({ where: { userId } });
  if (!student) {
    return { error: 'Student profile not found. Please contact support.' };
  }

  const trip = await prisma.trip.create({
    data: {
      studentId: student.id,
      pickupLocationId: data.pickupLocationId,
      dropoffLocationId: data.dropoffLocationId,
      passengerCount: data.passengerCount,
      rideType: data.rideType,
      totalFare,
      status: 'PENDING',
      passengers: {
        create: {
          userId: userId,
        },
      },
    },
    include: {
      pickupLocation: true,
      dropoffLocation: true,
    },
  });

  await prisma.rideStatusHistory.create({
    data: {
      tripId: trip.id,
      userId: userId,
      from: 'PENDING',
      to: 'PENDING',
    },
  });

  // Audit log
  logTripStatusChange({
    userId,
    tripId: trip.id,
    action: 'trip.created',
    from: 'NONE',
    to: 'PENDING',
    studentId: userId,
    fare: totalFare,
    pickup: pickup.name,
    dropoff: dropoff.name,
  }).catch(() => {});

  // Notify online drivers
  const onlineDrivers = await prisma.driver.findMany({
    where: { isOnline: true },
  });

  for (const driver of onlineDrivers) {
    await prisma.notification.create({
      data: {
        userId: driver.userId,
        title: 'New Ride Request',
        message: `New ride from ${pickup.name} to ${dropoff.name} for ${data.passengerCount} passenger(s).`,
        type: 'NEW_RIDE_REQUEST',
      },
    });
  }

  return { success: true, trip };
}

export async function acceptTrip(tripId: string) {
  const session = await auth();
  if (!session?.user) {
    return { error: 'You must be logged in.' };
  }

  const userId = await getUserId();
  const driver = await prisma.driver.findUnique({ where: { userId } });

  if (!driver) {
    return { error: 'Driver account not found.' };
  }

  if (!driver.isOnline) {
    return { error: 'You must be online to accept rides.' };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const trip = await tx.trip.findUnique({ where: { id: tripId } });
      if (!trip) throw new Error('Trip not found.');
      if (trip.status !== 'PENDING' || trip.driverId !== null) {
        throw new Error('This ride is no longer available.');
      }

      const updated = await tx.trip.update({
        where: { id: tripId, status: 'PENDING', driverId: null },
        data: { driverId: driver.id, status: 'ACCEPTED' },
        include: { pickupLocation: true, dropoffLocation: true },
      });

      await tx.rideStatusHistory.create({
        data: { tripId, userId, from: 'PENDING', to: 'ACCEPTED' },
      });

      // Look up student's User record for notification
      const studentForNotif = await tx.student.findUnique({ where: { id: updated.studentId } });
      await tx.notification.create({
        data: {
          userId: studentForNotif?.userId ?? updated.studentId,
          title: 'Ride Accepted',
          message: `Your ride from ${updated.pickupLocation.name} to ${updated.dropoffLocation.name} has been accepted.`,
          type: 'RIDE_ACCEPTED',
        },
      });

      return updated;
    });

    // Audit log (non-blocking)
    logTripStatusChange({
      userId,
      tripId,
      action: 'trip.accepted',
      from: 'PENDING',
      to: 'ACCEPTED',
      driverId: driver.id,
      studentId: result.studentId,
      fare: result.totalFare,
      pickup: result.pickupLocation.name,
      dropoff: result.dropoffLocation.name,
    }).catch(() => {});

    // Send email notification (non-blocking)
    const studentRecord = await prisma.student.findUnique({ where: { id: result.studentId } });
    const studentUser = studentRecord ? await prisma.user.findUnique({ where: { id: studentRecord.userId } }) : null;
    if (studentUser?.email) {
      sendRideAcceptedEmail({
        to: studentUser.email,
        studentName: studentUser.name,
        driverName: session.user.name || 'Driver',
        pickup: result.pickupLocation.name,
        dropoff: result.dropoffLocation.name,
        passengerCount: result.passengerCount,
        fare: result.totalFare,
      }).catch(() => {});
    }

    return { success: true, trip: result };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to accept ride.';
    return { error: message };
  }
}

export async function rejectTrip(tripId: string) {
  return { success: true, message: 'Ride declined.' };
}

export async function startTrip(tripId: string) {
  const userId = await getUserId();
  const driver = await prisma.driver.findUnique({ where: { userId } });
  if (!driver) return { error: 'Driver account not found.' };

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) return { error: 'Trip not found.' };
  if (trip.driverId !== driver.id) return { error: 'You are not assigned to this trip.' };
  if (trip.status !== 'ACCEPTED') return { error: 'Invalid status transition.' };

  const driverUser = await prisma.user.findUnique({ where: { id: userId } });

  const updated = await prisma.trip.update({
    where: { id: tripId },
    data: { status: 'IN_PROGRESS' },
    include: { pickupLocation: true, dropoffLocation: true },
  });

  await prisma.rideStatusHistory.create({
    data: { tripId, userId, from: 'ACCEPTED', to: 'IN_PROGRESS' },
  });

  // Audit log (non-blocking)
  logTripStatusChange({
    userId,
    tripId,
    action: 'trip.started',
    from: 'ACCEPTED',
    to: 'IN_PROGRESS',
    driverId: driver.id,
    studentId: trip.studentId,
    fare: trip.totalFare,
    pickup: updated.pickupLocation.name,
    dropoff: updated.dropoffLocation.name,
  }).catch(() => {});

  // Look up student's User record for notifications
  const studentForNotif = await prisma.student.findUnique({ where: { id: trip.studentId } });
  const studentUserIdForNotif = studentForNotif?.userId ?? trip.studentId;
  await prisma.notification.create({
    data: {
      userId: studentUserIdForNotif,
      title: 'Ride Started',
      message: `Your ride from ${updated.pickupLocation.name} to ${updated.dropoffLocation.name} has started.`,
      type: 'RIDE_STARTED',
    },
  });

  // Send email (non-blocking)
  const studentUser = studentForNotif ? await prisma.user.findUnique({ where: { id: studentForNotif.userId } }) : null;
  if (studentUser?.email && driverUser) {
    sendRideStartedEmail({
      to: studentUser.email,
      studentName: studentUser.name,
      driverName: driverUser.name,
      pickup: updated.pickupLocation.name,
      dropoff: updated.dropoffLocation.name,
    }).catch(() => {});
  }

  return { success: true, trip: updated };
}

export async function completeTrip(tripId: string) {
  const userId = await getUserId();
  const driver = await prisma.driver.findUnique({ where: { userId } });
  if (!driver) return { error: 'Driver account not found.' };

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) return { error: 'Trip not found.' };
  if (trip.driverId !== driver.id) return { error: 'You are not assigned to this trip.' };
  if (trip.status !== 'IN_PROGRESS') return { error: 'Invalid status transition.' };

  const driverUser = await prisma.user.findUnique({ where: { id: userId } });

  const updated = await prisma.trip.update({
    where: { id: tripId },
    data: { status: 'COMPLETED' },
    include: { pickupLocation: true, dropoffLocation: true },
  });

  await prisma.rideStatusHistory.create({
    data: { tripId, userId, from: 'IN_PROGRESS', to: 'COMPLETED' },
  });

  await prisma.driver.update({
    where: { id: driver.id },
    data: { totalTrips: { increment: 1 } },
  });

  // Audit log (non-blocking)
  logTripStatusChange({
    userId,
    tripId,
    action: 'trip.completed',
    from: 'IN_PROGRESS',
    to: 'COMPLETED',
    driverId: driver.id,
    studentId: trip.studentId,
    fare: trip.totalFare,
    pickup: updated.pickupLocation.name,
    dropoff: updated.dropoffLocation.name,
  }).catch(() => {});

  // Look up student's User record for notifications and email
  const studentRec = await prisma.student.findUnique({ where: { id: trip.studentId } });
  const studentUserId = studentRec?.userId ?? trip.studentId;
  await prisma.notification.create({
    data: {
      userId: studentUserId,
      title: 'Ride Completed',
      message: `Your ride from ${updated.pickupLocation.name} to ${updated.dropoffLocation.name} has been completed.`,
      type: 'RIDE_COMPLETED',
    },
  });

  // Send email (non-blocking)
  const studentUser = studentRec ? await prisma.user.findUnique({ where: { id: studentRec.userId } }) : null;
  if (studentUser?.email && driverUser) {
    sendRideCompletedEmail({
      to: studentUser.email,
      studentName: studentUser.name,
      driverName: driverUser.name,
      pickup: updated.pickupLocation.name,
      dropoff: updated.dropoffLocation.name,
      passengerCount: updated.passengerCount,
      fare: updated.totalFare,
    }).catch(() => {});
  }

  return { success: true, trip: updated };
}

export async function getActiveTripStatus() {
  const userId = await getUserId();
  const student = await prisma.student.findUnique({ where: { userId } });
  if (!student) return { trip: null };

  const trip = await prisma.trip.findFirst({
    where: {
      studentId: student.id,
      status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] },
    },
    include: {
      pickupLocation: true,
      dropoffLocation: true,
      driver: { include: { user: true, vehicle: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return { trip };
}

export async function cancelTrip(tripId: string) {
  const userId = await getUserId();

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) return { error: 'Trip not found.' };

  // Check if this user is the student for this trip
  const tripStudent = await prisma.student.findUnique({ where: { id: trip.studentId } });
  const isStudent = tripStudent?.userId === userId;

  if (!isStudent && trip.driverId === null) {
    return { error: 'You are not part of this trip.' };
  }

  if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED') {
    return { error: 'Cannot cancel a completed or cancelled trip.' };
  }

  const pickup = await prisma.campusLocation.findUnique({ where: { id: trip.pickupLocationId } });
  const dropoff = await prisma.campusLocation.findUnique({ where: { id: trip.dropoffLocationId } });

  const updated = await prisma.trip.update({
    where: { id: tripId },
    data: { status: 'CANCELLED' },
  });

  await prisma.rideStatusHistory.create({
    data: { tripId, userId, from: trip.status, to: 'CANCELLED' },
  });

  // Audit log (non-blocking)
  logTripStatusChange({
    userId,
    tripId,
    action: 'trip.cancelled',
    from: trip.status,
    to: 'CANCELLED',
    driverId: trip.driverId ?? undefined,
    studentId: trip.studentId,
    fare: trip.totalFare,
    pickup: pickup?.name,
    dropoff: dropoff?.name,
  }).catch(() => {});

  // Notify and email the other party
  if (isStudent && trip.driverId) {
    const driver = await prisma.driver.findUnique({ where: { id: trip.driverId } });
    if (driver) {
      await prisma.notification.create({
        data: {
          userId: driver.userId,
          title: 'Ride Cancelled',
          message: 'A ride has been cancelled by the student.',
          type: 'RIDE_CANCELLED',
        },
      });

      const driverUser = await prisma.user.findUnique({ where: { id: driver.userId } });
      if (driverUser?.email) {
        sendRideCancelledEmail({
          to: driverUser.email,
          recipientName: driverUser.name,
          cancelledBy: 'student',
          pickup: pickup?.name || 'Unknown',
          dropoff: dropoff?.name || 'Unknown',
        }).catch(() => {});
      }
    }
  } else if (!isStudent && trip.driverId) {
    // Look up student's User record for notification and email
    const cancelStudentRec = await prisma.student.findUnique({ where: { id: trip.studentId } });
    const cancelStudentUserId = cancelStudentRec?.userId ?? trip.studentId;
    await prisma.notification.create({
      data: {
        userId: cancelStudentUserId,
        title: 'Ride Cancelled',
        message: 'Your ride has been cancelled by the driver.',
        type: 'RIDE_CANCELLED',
      },
    });

    const studentUser = cancelStudentRec ? await prisma.user.findUnique({ where: { id: cancelStudentRec.userId } }) : null;
    if (studentUser?.email) {
      sendRideCancelledEmail({
        to: studentUser.email,
        recipientName: studentUser.name,
        cancelledBy: 'driver',
        pickup: pickup?.name || 'Unknown',
        dropoff: dropoff?.name || 'Unknown',
      }).catch(() => {});
    }
  }

  return { success: true, trip: updated };
}
