/**
 * Mobile service layer.
 *
 * The website drives these flows through next-auth server actions. React
 * Native cannot call server actions, so the mobile API reuses the same Prisma
 * models, fare calculator, payment facade and commission accrual through the
 * functions below. Business rules are kept identical to the web actions:
 *
 *  - fares are always calculated server-side from the stored ride type;
 *  - a driver can only accept a trip whose payment succeeded;
 *  - going online requires the latest vehicle inspection to be COMPLETED;
 *  - completion requires a successful payment and accrues the school
 *    commission exactly once;
 *  - payouts only run when Flutterwave transfers are enabled.
 */

import { prisma } from '@/lib/prisma';
import { calculateFare } from '@/lib/fares';
import { createPayment, verifyPayment } from '@/lib/payments';
import { resolveBankAccount } from '@/lib/payments/flutterwave';
import { findBankByCode } from '@/lib/payments/banks';
import { accrueEarningForTrip } from '@/lib/commission/earnings';
import { logAudit, logTripStatusChange } from '@/lib/audit';
import { createPayoutForTrip } from '@/lib/payments';
import { z } from 'zod';
import type { MobileAccount } from '@/lib/mobile/auth';
import { sendExpoPushToUser, sendExpoPushToUsers } from '@/lib/mobile/push';

const bookingInput = z.object({
  pickupLocationId: z.string().uuid('Select a pickup location'),
  dropoffLocationId: z.string().uuid('Select a drop-off location'),
  passengerCount: z.number().int().min(1, 'At least 1 passenger').max(10, 'Maximum 10 passengers'),
  rideType: z.enum(['SOLO_QUICK_CAB', 'SHARED_SHUTTLE']),
});

export type TripView = ReturnType<typeof serializeTrip>;

const tripInclude = {
  pickupLocation: true,
  dropoffLocation: true,
  driver: { include: { user: true, vehicle: true } },
  payments: { orderBy: { createdAt: 'desc' as const }, take: 1 },
} as const;

function serializeTrip(trip: {
  id: string;
  status: string;
  rideType: string;
  passengerCount: number;
  totalFare: number;
  appCharge: number;
  driverEarnings: number;
  createdAt: Date;
  updatedAt: Date;
  pickupLocation: { name: string };
  dropoffLocation: { name: string };
  driver?: {
    avgRating: number;
    totalTrips: number;
    user: { name: string; phone: string };
    vehicle: { make: string; model: string; color: string; licensePlate: string } | null;
  } | null;
  payments?: Array<{ status: string; reference: string; totalAmount: number }>;
}) {
  const payment = trip.payments?.[0];
  return {
    id: trip.id,
    status: trip.status,
    rideType: trip.rideType,
    passengerCount: trip.passengerCount,
    totalFare: trip.totalFare,
    platformFee: trip.appCharge,
    driverEarnings: trip.driverEarnings,
    pickup: trip.pickupLocation.name,
    dropoff: trip.dropoffLocation.name,
    createdAt: trip.createdAt.toISOString(),
    updatedAt: trip.updatedAt.toISOString(),
    driver: trip.driver
      ? {
          name: trip.driver.user.name,
          phone: trip.driver.user.phone,
          rating: trip.driver.avgRating,
          trips: trip.driver.totalTrips,
          vehicle: trip.driver.vehicle
            ? `${trip.driver.vehicle.color} ${trip.driver.vehicle.make} ${trip.driver.vehicle.model}`
            : null,
          plate: trip.driver.vehicle?.licensePlate ?? null,
        }
      : null,
    payment: payment
      ? { status: payment.status, reference: payment.reference, amount: payment.totalAmount }
      : null,
  };
}

export async function listTrips(account: MobileAccount, scope: 'active' | 'history') {
  if (account.role === 'STUDENT') {
    if (!account.studentId) return [];
    const trips = await prisma.trip.findMany({
      where: {
        studentId: account.studentId,
        status:
          scope === 'active'
            ? { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] }
            : { in: ['COMPLETED', 'CANCELLED'] },
      },
      include: tripInclude,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return trips.map(serializeTrip);
  }

  if (account.role === 'DRIVER') {
    if (!account.driverId) return [];
    const trips = await prisma.trip.findMany({
      where: {
        driverId: account.driverId,
        status:
          scope === 'active'
            ? { in: ['ACCEPTED', 'IN_PROGRESS'] }
            : { in: ['COMPLETED', 'CANCELLED'] },
      },
      include: tripInclude,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return trips.map(serializeTrip);
  }

  return [];
}

export async function getTrip(account: MobileAccount, tripId: string) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, include: tripInclude });
  if (!trip) return { error: 'Trip not found.' as const };

  const owns =
    (account.role === 'STUDENT' && trip.studentId === account.studentId) ||
    (account.role === 'DRIVER' && trip.driverId === account.driverId) ||
    account.role === 'ADMIN';

  if (!owns) return { error: 'You do not have access to this trip.' as const };
  return { trip: serializeTrip(trip) };
}

export async function createTrip(
  account: MobileAccount,
  input: unknown
): Promise<{ error: string } | { trip: TripView }> {
  if (account.role !== 'STUDENT') return { error: 'Only students can book rides.' };
  if (!account.studentId) return { error: 'Student profile not found. Please contact support.' };

  const parsed = bookingInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const data = parsed.data;
  if (data.pickupLocationId === data.dropoffLocationId) {
    return { error: 'Pickup and drop-off locations must be different.' };
  }

  const [pickup, dropoff] = await Promise.all([
    prisma.campusLocation.findUnique({ where: { id: data.pickupLocationId } }),
    prisma.campusLocation.findUnique({ where: { id: data.dropoffLocationId } }),
  ]);
  if (!pickup || !dropoff) return { error: 'Invalid location selected.' };

  const fare = calculateFare(data.rideType);

  const trip = await prisma.trip.create({
    data: {
      studentId: account.studentId,
      pickupLocationId: data.pickupLocationId,
      dropoffLocationId: data.dropoffLocationId,
      passengerCount: data.passengerCount,
      rideType: data.rideType,
      totalFare: fare.totalAmount,
      appCharge: fare.platformFee,
      driverEarnings: fare.rideFare,
      status: 'PENDING',
      passengers: { create: { userId: account.id } },
    },
    include: tripInclude,
  });

  await prisma.rideStatusHistory.create({
    data: { tripId: trip.id, userId: account.id, from: 'PENDING', to: 'PENDING' },
  });

  logTripStatusChange({
    userId: account.id,
    tripId: trip.id,
    action: 'trip.created',
    from: 'NONE',
    to: 'PENDING',
    studentId: account.id,
    fare: fare.totalAmount,
    pickup: pickup.name,
    dropoff: dropoff.name,
  }).catch(() => {});

  // Notify online drivers in-app, and push to their devices.
  const onlineDrivers = await prisma.driver.findMany({
    where: { isOnline: true },
    select: { userId: true },
  });

  if (onlineDrivers.length > 0) {
    await prisma.notification.createMany({
      data: onlineDrivers.map((driver) => ({
        userId: driver.userId,
        title: 'New Ride Request',
        message: `New ride from ${pickup.name} to ${dropoff.name} for ${data.passengerCount} passenger(s).`,
        type: 'NEW_RIDE_REQUEST',
      })),
    });
    sendExpoPushToUsers(
      onlineDrivers.map((driver) => driver.userId),
      'New ride request',
      `${pickup.name} → ${dropoff.name} · ₦${fare.totalAmount.toLocaleString('en-NG')}`
    ).catch(() => {});
  }

  return { trip: serializeTrip(trip) };
}

export async function initPayment(
  account: MobileAccount,
  tripId: string,
  returnUrl: string
): Promise<{ error: string } | { checkoutUrl: string; reference: string; amount: number }> {
  if (account.role !== 'STUDENT') return { error: 'Only students can pay for rides.' };
  if (!account.studentId) return { error: 'Student profile not found.' };

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) return { error: 'Trip not found.' };
  if (trip.studentId !== account.studentId) return { error: 'You can only pay for your own trips.' };
  if (trip.status !== 'PENDING') return { error: 'This trip is no longer accepting payments.' };

  const paid = await prisma.payment.findFirst({
    where: { tripId, userId: account.id, status: 'SUCCESSFUL' },
  });
  if (paid) return { error: 'This trip has already been paid for.' };

  const fare = calculateFare(trip.rideType as 'SOLO_QUICK_CAB' | 'SHARED_SHUTTLE');

  const result = await createPayment({
    tripId,
    userId: account.id,
    passengerCount: trip.passengerCount,
    rideFare: fare.rideFare,
    platformFee: fare.platformFee,
    totalAmount: fare.totalAmount,
    email: account.email,
    redirectUrl: returnUrl,
  });

  if (!result.success) {
    return { error: result.error ?? 'Could not start the payment.' };
  }
  if (!result.checkoutUrl || !result.reference) {
    return { error: 'The payment provider did not return a checkout link.' };
  }

  return {
    checkoutUrl: result.checkoutUrl,
    reference: result.reference,
    amount: result.amount ?? fare.totalAmount,
  };
}

export async function verifyPaymentForAccount(account: MobileAccount, reference: string) {
  const payment = await prisma.payment.findUnique({ where: { reference } });
  if (!payment) return { error: 'Payment not found.' };
  if (payment.userId !== account.id) return { error: 'You do not have access to this payment.' };

  if (payment.status === 'SUCCESSFUL') {
    return { status: 'successful' as const, reference, tripId: payment.tripId };
  }

  const result = await verifyPayment(reference);
  if (result.success) {
    const fresh = await prisma.payment.findUnique({ where: { reference } });
    return {
      status: 'successful' as const,
      reference,
      tripId: payment.tripId,
      paymentStatus: fresh?.status,
    };
  }

  const latest = await prisma.payment.findUnique({ where: { reference } });
  if (latest?.status === 'FAILED') {
    return { status: 'failed' as const, reference, error: result.error ?? latest.failureReason ?? undefined };
  }
  if (latest?.status === 'ABANDONED') {
    return { status: 'abandoned' as const, reference };
  }
  return { status: 'pending' as const, reference, error: result.error };
}

export async function acceptRide(account: MobileAccount, tripId: string) {
  if (account.role !== 'DRIVER') return { error: 'Only drivers can accept rides.' };
  if (!account.driverId) return { error: 'Driver account not found.' };

  const driver = await prisma.driver.findUnique({ where: { id: account.driverId } });
  if (!driver) return { error: 'Driver account not found.' };
  if (!driver.isOnline) return { error: 'You must be online to accept rides.' };

  const latest = await prisma.vehicleInspection.findFirst({
    where: { driverId: driver.id },
    orderBy: { createdAt: 'desc' },
  });
  if (!latest || latest.status !== 'COMPLETED') {
    return { error: 'Complete your vehicle inspection before accepting rides.' };
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const trip = await tx.trip.findUnique({ where: { id: tripId } });
      if (!trip) throw new Error('Trip not found.');
      if (trip.status !== 'PENDING' || trip.driverId !== null) {
        throw new Error('This ride is no longer available.');
      }

      const paid = await tx.payment.findFirst({
        where: { tripId, status: 'SUCCESSFUL' },
        select: { id: true },
      });
      if (!paid) throw new Error('This ride has not been paid for yet.');

      const claimed = await tx.trip.update({
        where: { id: tripId, status: 'PENDING', driverId: null },
        data: { driverId: driver.id, status: 'ACCEPTED' },
        include: tripInclude,
      });

      await tx.rideStatusHistory.create({
        data: { tripId, userId: account.id, from: 'PENDING', to: 'ACCEPTED' },
      });

      const student = await tx.student.findUnique({ where: { id: claimed.studentId } });
      await tx.notification.create({
        data: {
          userId: student?.userId ?? claimed.studentId,
          title: 'Ride Accepted',
          message: `Your ride from ${claimed.pickupLocation.name} to ${claimed.dropoffLocation.name} has been accepted.`,
          type: 'RIDE_ACCEPTED',
        },
      });

      return { trip: claimed, studentUserId: student?.userId ?? claimed.studentId };
    });

    logTripStatusChange({
      userId: account.id,
      tripId,
      action: 'trip.accepted',
      from: 'PENDING',
      to: 'ACCEPTED',
      driverId: driver.id,
      studentId: updated.trip.studentId,
      fare: updated.trip.totalFare,
      pickup: updated.trip.pickupLocation.name,
      dropoff: updated.trip.dropoffLocation.name,
    }).catch(() => {});

    sendExpoPushToUser(
      updated.studentUserId,
      'Driver on the way',
      `${account.name} accepted your ride from ${updated.trip.pickupLocation.name}.`
    ).catch(() => {});

    return { trip: serializeTrip(updated.trip) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to accept ride.' };
  }
}

export async function startRide(account: MobileAccount, tripId: string) {
  if (account.role !== 'DRIVER') return { error: 'Only drivers can start rides.' };
  if (!account.driverId) return { error: 'Driver account not found.' };

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) return { error: 'Trip not found.' };
  if (trip.driverId !== account.driverId) return { error: 'You are not assigned to this trip.' };
  if (trip.status !== 'ACCEPTED') return { error: 'This ride cannot be started yet.' };

  const updated = await prisma.trip.update({
    where: { id: tripId },
    data: { status: 'IN_PROGRESS' },
    include: tripInclude,
  });

  await prisma.rideStatusHistory.create({
    data: { tripId, userId: account.id, from: 'ACCEPTED', to: 'IN_PROGRESS' },
  });

  const student = await prisma.student.findUnique({ where: { id: trip.studentId } });
  const studentUserId = student?.userId ?? trip.studentId;
  await prisma.notification.create({
    data: {
      userId: studentUserId,
      title: 'Ride Started',
      message: `Your ride from ${updated.pickupLocation.name} to ${updated.dropoffLocation.name} has started.`,
      type: 'RIDE_STARTED',
    },
  });

  logTripStatusChange({
    userId: account.id,
    tripId,
    action: 'trip.started',
    from: 'ACCEPTED',
    to: 'IN_PROGRESS',
    driverId: account.driverId,
    studentId: trip.studentId,
    fare: trip.totalFare,
    pickup: updated.pickupLocation.name,
    dropoff: updated.dropoffLocation.name,
  }).catch(() => {});

  sendExpoPushToUser(studentUserId, 'Ride started', 'Your CampusCab ride is now in progress.').catch(
    () => {}
  );

  return { trip: serializeTrip(updated) };
}

export async function completeRide(account: MobileAccount, tripId: string) {
  if (account.role !== 'DRIVER') return { error: 'Only drivers can complete rides.' };
  if (!account.driverId) return { error: 'Driver account not found.' };

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) return { error: 'Trip not found.' };
  if (trip.driverId !== account.driverId) return { error: 'You are not assigned to this trip.' };
  if (trip.status !== 'IN_PROGRESS') return { error: 'This ride is not in progress.' };

  const payment = await prisma.payment.findFirst({
    where: { tripId, status: 'SUCCESSFUL' },
  });
  if (!payment) return { error: 'Payment has not been confirmed for this ride.' };

  const updated = await prisma.trip.update({
    where: { id: tripId },
    data: { status: 'COMPLETED' },
    include: tripInclude,
  });

  await prisma.rideStatusHistory.create({
    data: { tripId, userId: account.id, from: 'IN_PROGRESS', to: 'COMPLETED' },
  });

  await prisma.driver.update({
    where: { id: account.driverId },
    data: { totalTrips: { increment: 1 } },
  });

  try {
    await accrueEarningForTrip(tripId);
  } catch (e) {
    console.error('[MOBILE][COMMISSION] accrual failed', tripId, e);
  }

  const student = await prisma.student.findUnique({ where: { id: trip.studentId } });
  const studentUserId = student?.userId ?? trip.studentId;
  await prisma.notification.create({
    data: {
      userId: studentUserId,
      title: 'Ride Completed',
      message: `Your ride from ${updated.pickupLocation.name} to ${updated.dropoffLocation.name} has been completed.`,
      type: 'RIDE_COMPLETED',
    },
  });

  logTripStatusChange({
    userId: account.id,
    tripId,
    action: 'trip.completed',
    from: 'IN_PROGRESS',
    to: 'COMPLETED',
    driverId: account.driverId,
    studentId: trip.studentId,
    fare: trip.totalFare,
    pickup: updated.pickupLocation.name,
    dropoff: updated.dropoffLocation.name,
  }).catch(() => {});

  sendExpoPushToUser(
    studentUserId,
    'Ride completed',
    `Thanks for riding with CampusCab. ₦${trip.totalFare.toLocaleString('en-NG')} was your total fare.`
  ).catch(() => {});

  return { trip: serializeTrip(updated) };
}

export async function cancelRide(account: MobileAccount, tripId: string) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) return { error: 'Trip not found.' };

  const isStudent = account.studentId != null && trip.studentId === account.studentId;
  const isDriver = account.driverId != null && trip.driverId === account.driverId;
  if (!isStudent && !isDriver) return { error: 'You are not part of this trip.' };

  if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED') {
    return { error: 'This ride can no longer be cancelled.' };
  }

  const updated = await prisma.trip.update({
    where: { id: tripId },
    data: { status: 'CANCELLED' },
    include: tripInclude,
  });

  await prisma.rideStatusHistory.create({
    data: { tripId, userId: account.id, from: trip.status, to: 'CANCELLED' },
  });

  await prisma.payment.updateMany({
    where: { tripId, status: 'PENDING' },
    data: { status: 'ABANDONED' },
  });

  const [pickup, dropoff] = await Promise.all([
    prisma.campusLocation.findUnique({ where: { id: trip.pickupLocationId } }),
    prisma.campusLocation.findUnique({ where: { id: trip.dropoffLocationId } }),
  ]);

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
      sendExpoPushToUser(driver.userId, 'Ride cancelled', 'The student cancelled this ride.').catch(
        () => {}
      );
    }
  } else if (isDriver) {
    const student = await prisma.student.findUnique({ where: { id: trip.studentId } });
    const studentUserId = student?.userId ?? trip.studentId;
    await prisma.notification.create({
      data: {
        userId: studentUserId,
        title: 'Ride Cancelled',
        message: 'Your ride has been cancelled by the driver.',
        type: 'RIDE_CANCELLED',
      },
    });
    sendExpoPushToUser(
      studentUserId,
      'Ride cancelled',
      `Your ride was cancelled by the driver. Please book again.`
    ).catch(() => {});
  }

  logTripStatusChange({
    userId: account.id,
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

  return { trip: serializeTrip(updated) };
}

export async function rateTrip(
  account: MobileAccount,
  tripId: string,
  score: number,
  feedback?: string
) {
  if (account.role !== 'STUDENT') return { error: 'Only students can rate rides.' };
  if (!account.studentId) return { error: 'Student profile not found.' };
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return { error: 'Rating must be between 1 and 5.' };
  }

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) return { error: 'Trip not found.' };
  if (trip.studentId !== account.studentId) return { error: 'You can only rate your own trips.' };
  if (trip.status !== 'COMPLETED') return { error: 'Only completed rides can be rated.' };
  if (!trip.driverId) return { error: 'No driver is assigned to this trip.' };

  const existing = await prisma.rating.findFirst({ where: { tripId, userId: account.id } });
  if (existing) return { error: 'You have already rated this ride.' };

  const rating = await prisma.rating.create({
    data: {
      tripId,
      driverId: trip.driverId,
      userId: account.id,
      score,
      feedback: feedback?.slice(0, 500),
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

  logAudit({
    userId: account.id,
    action: 'rating.submitted',
    entity: 'Rating',
    entityId: rating.id,
    details: { tripId, driverId: trip.driverId, score },
  }).catch(() => {});

  return { success: true };
}

// ─── Driver ──────────────────────────────────────────

export async function driverSummary(account: MobileAccount) {
  if (account.role !== 'DRIVER' || !account.driverId) return { error: 'Driver account not found.' };

  const [driver, inspection, earnings, payouts, activeTrip, availableRequests, account_] =
    await Promise.all([
      prisma.driver.findUnique({
        where: { id: account.driverId },
        include: { user: true, vehicle: true },
      }),
      prisma.vehicleInspection.findFirst({
        where: { driverId: account.driverId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.driverEarning.aggregate({
        where: { driverId: account.driverId, status: 'ACCRUED' },
        _sum: { netAmountKobo: true },
      }),
      prisma.driverEarning.aggregate({
        where: { driverId: account.driverId, status: 'ACCRUED', payoutStatus: 'UNPAID' },
        _sum: { netAmountKobo: true },
        _count: true,
      }),
      prisma.trip.findFirst({
        where: { driverId: account.driverId, status: { in: ['ACCEPTED', 'IN_PROGRESS'] } },
        include: tripInclude,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.trip.count({
        where: { driverId: null, status: 'PENDING', payments: { some: { status: 'SUCCESSFUL' } } },
      }),
      prisma.driverPaymentAccount.findUnique({ where: { driverId: account.driverId } }),
    ]);

  if (!driver) return { error: 'Driver account not found.' };

  return {
    driver: {
      name: driver.user.name,
      phone: driver.user.phone,
      email: driver.user.email,
      driverCode: driver.driverId,
      isOnline: driver.isOnline,
      rating: driver.avgRating,
      totalTrips: driver.totalTrips,
      vehicle: driver.vehicle
        ? {
            make: driver.vehicle.make,
            model: driver.vehicle.model,
            color: driver.vehicle.color,
            plate: driver.vehicle.licensePlate,
          }
        : null,
    },
    inspection: inspection
      ? { id: inspection.id, status: inspection.status, createdAt: inspection.createdAt.toISOString() }
      : null,
    canGoOnline: inspection?.status === 'COMPLETED',
    earnings: {
      lifetimeKobo: earnings._sum.netAmountKobo ?? 0,
      unpaidKobo: payouts._sum.netAmountKobo ?? 0,
      unpaidCount: payouts._count,
    },
    bankAccount: account_
      ? {
          bankName: account_.bankName,
          accountNumber: account_.accountNumber
            ? `••••${account_.accountNumber.slice(-4)}`
            : null,
          accountName: account_.accountName,
          verified: account_.verificationStatus === 'VERIFIED',
        }
      : null,
    activeTrip: activeTrip ? serializeTrip(activeTrip) : null,
    availableRequests,
  };
}

export async function availableRides(account: MobileAccount) {
  if (account.role !== 'DRIVER') return { error: 'Only drivers can view ride requests.' };
  const trips = await prisma.trip.findMany({
    where: { driverId: null, status: 'PENDING', payments: { some: { status: 'SUCCESSFUL' } } },
    include: tripInclude,
    orderBy: { createdAt: 'asc' },
    take: 20,
  });
  return { rides: trips.map(serializeTrip) };
}

export async function setOnline(account: MobileAccount, online: boolean) {
  if (account.role !== 'DRIVER' || !account.driverId) return { error: 'Driver account not found.' };

  const driver = await prisma.driver.findUnique({
    where: { id: account.driverId },
    include: { inspections: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!driver) return { error: 'Driver account not found.' };

  if (online) {
    const latest = driver.inspections[0];
    if (!latest || latest.status !== 'COMPLETED') {
      return { error: 'Complete your vehicle inspection before going online.' };
    }
  }

  const updated = await prisma.driver.update({
    where: { id: driver.id },
    data: { isOnline: online },
  });

  logAudit({
    userId: account.id,
    action: online ? 'driver.went_online' : 'driver.went_offline',
    entity: 'Driver',
    entityId: driver.id,
  }).catch(() => {});

  return { isOnline: updated.isOnline };
}

const inspectionInput = z.object({
  brakes: z.boolean(),
  tires: z.boolean(),
  lights: z.boolean(),
  interiorClean: z.boolean(),
  noTrash: z.boolean(),
  fireExtinguisher: z.boolean(),
  firstAidKit: z.boolean(),
  fuelBattery: z.boolean(),
});

export async function submitInspection(account: MobileAccount, input: unknown) {
  if (account.role !== 'DRIVER' || !account.driverId) return { error: 'Driver account not found.' };

  const parsed = inspectionInput.safeParse(input);
  if (!parsed.success) return { error: 'Every checklist item must be answered.' };

  const data = parsed.data;
  const allPassed = Object.values(data).every(Boolean);

  const inspection = await prisma.vehicleInspection.create({
    data: { driverId: account.driverId, ...data, status: allPassed ? 'COMPLETED' : 'DRAFT' },
  });

  logAudit({
    userId: account.id,
    action: 'driver.inspection_submitted',
    entity: 'VehicleInspection',
    entityId: inspection.id,
    details: { status: inspection.status },
  }).catch(() => {});

  if (!allPassed) {
    return {
      inspection: { status: inspection.status },
      error: 'The inspection is incomplete. Every item must pass before you can go online.',
    };
  }

  return { inspection: { status: inspection.status } };
}

export async function getInspectionHistory(account: MobileAccount) {
  if (account.role !== 'DRIVER' || !account.driverId) return { error: 'Driver account not found.' };
  const rows = await prisma.vehicleInspection.findMany({
    where: { driverId: account.driverId },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  return {
    inspections: rows.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      items: {
        brakes: row.brakes,
        tires: row.tires,
        lights: row.lights,
        interiorClean: row.interiorClean,
        noTrash: row.noTrash,
        fireExtinguisher: row.fireExtinguisher,
        firstAidKit: row.firstAidKit,
        fuelBattery: row.fuelBattery,
      },
    })),
  };
}

export async function driverEarnings(account: MobileAccount) {
  if (account.role !== 'DRIVER' || !account.driverId) return { error: 'Driver account not found.' };

  const [earnings, payouts, bank] = await Promise.all([
    prisma.driverEarning.findMany({
      where: { driverId: account.driverId },
      orderBy: { earningDate: 'desc' },
      take: 50,
      include: { trip: { include: { pickupLocation: true, dropoffLocation: true } } },
    }),
    prisma.payout.findMany({
      where: { driverId: account.driverId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.driverPaymentAccount.findUnique({ where: { driverId: account.driverId } }),
  ]);

  return {
    earnings: earnings.map((row) => ({
      id: row.id,
      tripId: row.tripId,
      route: `${row.trip.pickupLocation.name} → ${row.trip.dropoffLocation.name}`,
      grossKobo: row.eligibleAmountKobo,
      commissionKobo: row.commissionAmountKobo,
      netKobo: row.netAmountKobo,
      status: row.status,
      payoutStatus: row.payoutStatus,
      date: row.earningDate.toISOString(),
    })),
    payouts: payouts.map((row) => ({
      id: row.id,
      amount: row.amount,
      status: row.status,
      reference: row.providerReference,
      failureReason: row.failureReason,
      createdAt: row.createdAt.toISOString(),
    })),
    bankAccount: bank
      ? {
          bankCode: bank.bankCode,
          bankName: bank.bankName,
          accountNumber: bank.accountNumber ? `••••${bank.accountNumber.slice(-4)}` : null,
          accountName: bank.accountName,
          verified: bank.verificationStatus === 'VERIFIED',
          verificationStatus: bank.verificationStatus,
        }
      : null,
  };
}

const bankInput = z.object({
  bankCode: z.string().trim().min(1, 'Select your bank'),
  accountNumber: z.string().trim().regex(/^\d{10}$/, 'Account number must be 10 digits'),
  accountName: z.string().trim().min(2, 'Enter the account name').max(100, 'Account name is too long'),
});

export async function saveBankAccount(account: MobileAccount, input: unknown) {
  if (account.role !== 'DRIVER' || !account.driverId) return { error: 'Driver account not found.' };

  const parsed = bankInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const bank = findBankByCode(parsed.data.bankCode);
  if (!bank) return { error: 'Select a supported bank.' };

  const resolution = await resolveBankAccount({
    bankCode: bank.code,
    accountNumber: parsed.data.accountNumber,
  });

  if ('error' in resolution && !resolution.unavailable) {
    return { error: `We could not verify this account: ${resolution.error}` };
  }

  const resolvedName = 'accountName' in resolution ? resolution.accountName : parsed.data.accountName;
  const verificationStatus = 'accountName' in resolution ? 'VERIFIED' : 'PENDING';

  const saved = await prisma.driverPaymentAccount.upsert({
    where: { driverId: account.driverId },
    update: {
      provider: 'FLUTTERWAVE',
      bankCode: bank.code,
      bankName: bank.name,
      accountNumber: parsed.data.accountNumber,
      accountName: resolvedName,
      providerRecipientId: null,
      verificationStatus,
      isActive: true,
    },
    create: {
      driverId: account.driverId,
      provider: 'FLUTTERWAVE',
      bankCode: bank.code,
      bankName: bank.name,
      accountNumber: parsed.data.accountNumber,
      accountName: resolvedName,
      verificationStatus,
      isActive: true,
    },
  });

  logAudit({
    userId: account.id,
    action: 'driver.bank_details_updated',
    entity: 'DriverPaymentAccount',
    entityId: saved.id,
    details: { bankCode: bank.code, verificationStatus, source: 'mobile' },
  }).catch(() => {});

  return {
    bankAccount: {
      bankName: bank.name,
      accountNumber: `••••${parsed.data.accountNumber.slice(-4)}`,
      accountName: resolvedName,
      verified: verificationStatus === 'VERIFIED',
    },
  };
}

export async function requestPayout(account: MobileAccount) {
  if (account.role !== 'DRIVER' || !account.driverId) return { error: 'Driver account not found.' };

  const accountRow = await prisma.driverPaymentAccount.findUnique({
    where: { driverId: account.driverId },
  });
  if (!accountRow?.isActive || !accountRow.bankCode || !accountRow.accountNumber) {
    return { error: 'Add your bank account details before requesting a payment.' };
  }
  if (accountRow.verificationStatus !== 'VERIFIED') {
    return {
      error:
        'Your bank account has not been verified yet. Re-save your bank details so we can confirm the account name.',
    };
  }

  const earnings = await prisma.driverEarning.findMany({
    where: { driverId: account.driverId, status: 'ACCRUED', payoutStatus: 'UNPAID' },
    select: { tripId: true, paymentId: true, netAmountKobo: true },
    orderBy: { earningDate: 'asc' },
  });
  const withPayment = earnings.filter(
    (e): e is { tripId: string; paymentId: string; netAmountKobo: number } => Boolean(e.paymentId)
  );
  if (withPayment.length === 0) return { error: 'You have no unpaid earnings to request right now.' };

  const open = await prisma.payout.findMany({
    where: {
      tripId: { in: withPayment.map((e) => e.tripId) },
      status: { in: ['PENDING', 'PROCESSING', 'SUCCESS'] },
    },
    select: { tripId: true },
  });
  const already = new Set(open.map((p) => p.tripId));
  const eligible = withPayment.filter((e) => !already.has(e.tripId));
  if (eligible.length === 0) return { error: 'Your earnings are already being processed.' };

  if (!process.env.FLUTTERWAVE_TRANSFERS_ENABLED) {
    return {
      error:
        'Payouts are not live yet — Flutterwave transfers are still being activated. Your balance stays safe.',
    };
  }

  let paidCount = 0;
  let firstError: string | undefined;
  for (const earning of eligible) {
    const result = await createPayoutForTrip({
      tripId: earning.tripId,
      paymentId: earning.paymentId,
    });
    if ('error' in result && result.error) {
      firstError ??= result.error;
      continue;
    }
    paidCount += 1;
  }

  if (paidCount === 0) return { error: firstError ?? 'Payment could not be started. Please try again.' };
  return { paidCount, pendingCount: eligible.length - paidCount };
}

// ─── Shared extras ───────────────────────────────────

export async function notificationsFor(account: MobileAccount) {
  const rows = await prisma.notification.findMany({
    where: { userId: account.id },
    orderBy: { createdAt: 'desc' },
    take: 40,
  });
  return {
    notifications: rows.map((row) => ({
      id: row.id,
      title: row.title,
      message: row.message,
      type: row.type,
      isRead: row.isRead,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export async function markNotification(account: MobileAccount, id: string | 'all') {
  if (id === 'all') {
    await prisma.notification.updateMany({ where: { userId: account.id }, data: { isRead: true } });
    return { success: true };
  }
  const row = await prisma.notification.findUnique({ where: { id } });
  if (!row || row.userId !== account.id) return { error: 'Notification not found.' };
  await prisma.notification.update({ where: { id }, data: { isRead: true } });
  return { success: true };
}

export async function triggerSos(
  account: MobileAccount,
  input: { latitude?: number; longitude?: number; notes?: string }
) {
  const activeTrip = account.studentId
    ? await prisma.trip.findFirst({
        where: { studentId: account.studentId, status: { in: ['ACCEPTED', 'IN_PROGRESS'] } },
      })
    : null;

  const alert = await prisma.safetyAlert.create({
    data: {
      userId: account.id,
      tripId: activeTrip?.id ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      notes: input.notes?.slice(0, 500) ?? null,
      status: 'PENDING',
    },
  });

  logAudit({
    userId: account.id,
    action: 'sos.triggered',
    entity: 'SafetyAlert',
    entityId: alert.id,
    details: { tripId: activeTrip?.id ?? null, source: 'mobile' },
  }).catch(() => {});

  return { success: true, alertId: alert.id };
}
