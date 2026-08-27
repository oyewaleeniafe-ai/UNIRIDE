import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, cleanDatabase, createTestStudent, createTestDriver, getTestLocation } from './setup';

const FARE_PER_PASSENGER = 200;
let counter = 0;
function u(suffix: string) { counter++; return `${suffix}-${counter}-${Date.now()}`; }

async function createPendingTrip(studentUserId: string) {
  const student = await prisma.student.findUnique({ where: { userId: studentUserId } });
  const pickup = await getTestLocation('Old Chapel');
  const dropoff = await getTestLocation('Library');
  return prisma.trip.create({
    data: {
      studentId: student!.id,
      pickupLocationId: pickup.id,
      dropoffLocationId: dropoff.id,
      passengerCount: 1,
      rideType: 'SOLO_QUICK_CAB',
      totalFare: FARE_PER_PASSENGER,
      status: 'PENDING',
    },
    include: { pickupLocation: true, dropoffLocation: true },
  });
}

describe('Trip Lifecycle', () => {
  beforeAll(async () => { await cleanDatabase(); });
  afterAll(async () => { await cleanDatabase(); });

  describe('Status Transitions', () => {
    it('PENDING → ACCEPTED', async () => {
      const student = await createTestStudent({ email: `${u('e')}@t.com`, matricNo: u('M') });
      const driver = await createTestDriver({ email: `${u('e')}@t.com`, driverId: u('D'), isOnline: true });
      const trip = await createPendingTrip(student.id);

      const updated = await prisma.trip.update({
        where: { id: trip.id, status: 'PENDING', driverId: null },
        data: { driverId: driver.driver!.id, status: 'ACCEPTED' },
      });
      expect(updated.status).toBe('ACCEPTED');
      expect(updated.driverId).toBe(driver.driver!.id);
    });

    it('ACCEPTED → IN_PROGRESS', async () => {
      const student = await createTestStudent({ email: `${u('e')}@t.com`, matricNo: u('M') });
      const driver = await createTestDriver({ email: `${u('e')}@t.com`, driverId: u('D'), isOnline: true });
      const trip = await createPendingTrip(student.id);

      await prisma.trip.update({ where: { id: trip.id }, data: { driverId: driver.driver!.id, status: 'ACCEPTED' } });
      const started = await prisma.trip.update({ where: { id: trip.id }, data: { status: 'IN_PROGRESS' } });
      expect(started.status).toBe('IN_PROGRESS');
    });

    it('IN_PROGRESS → COMPLETED', async () => {
      const student = await createTestStudent({ email: `${u('e')}@t.com`, matricNo: u('M') });
      const driver = await createTestDriver({ email: `${u('e')}@t.com`, driverId: u('D'), isOnline: true });
      const trip = await createPendingTrip(student.id);

      await prisma.trip.update({ where: { id: trip.id }, data: { driverId: driver.driver!.id, status: 'IN_PROGRESS' } });
      const completed = await prisma.trip.update({ where: { id: trip.id }, data: { status: 'COMPLETED' } });
      expect(completed.status).toBe('COMPLETED');
    });

    it('cancellation from PENDING', async () => {
      const student = await createTestStudent({ email: `${u('e')}@t.com`, matricNo: u('M') });
      const trip = await createPendingTrip(student.id);
      const cancelled = await prisma.trip.update({ where: { id: trip.id }, data: { status: 'CANCELLED' } });
      expect(cancelled.status).toBe('CANCELLED');
    });

    it('cancellation from ACCEPTED', async () => {
      const student = await createTestStudent({ email: `${u('e')}@t.com`, matricNo: u('M') });
      const driver = await createTestDriver({ email: `${u('e')}@t.com`, driverId: u('D'), isOnline: true });
      const trip = await createPendingTrip(student.id);
      await prisma.trip.update({ where: { id: trip.id }, data: { driverId: driver.driver!.id, status: 'ACCEPTED' } });
      const cancelled = await prisma.trip.update({ where: { id: trip.id }, data: { status: 'CANCELLED' } });
      expect(cancelled.status).toBe('CANCELLED');
    });
  });

  describe('RideStatusHistory', () => {
    it('creates history records', async () => {
      const student = await createTestStudent({ email: `${u('e')}@t.com`, matricNo: u('M') });
      const trip = await createPendingTrip(student.id);

      await prisma.rideStatusHistory.create({
        data: { tripId: trip.id, userId: student.id, from: 'PENDING', to: 'ACCEPTED' },
      });

      const history = await prisma.rideStatusHistory.findMany({ where: { tripId: trip.id } });
      expect(history.length).toBe(1);
      expect(history[0].from).toBe('PENDING');
      expect(history[0].to).toBe('ACCEPTED');
    });
  });

  describe('Concurrent Acceptance', () => {
    it('only one driver wins', async () => {
      const student = await createTestStudent({ email: `${u('e')}@t.com`, matricNo: u('M') });
      const d1 = await createTestDriver({ email: `${u('e')}@t.com`, driverId: u('D'), isOnline: true });
      const d2 = await createTestDriver({ email: `${u('e')}@t.com`, driverId: u('D'), isOnline: true });
      const trip = await createPendingTrip(student.id);

      const r1 = await prisma.$transaction(async (tx) => {
        const t = await tx.trip.findUnique({ where: { id: trip.id } });
        if (t?.status !== 'PENDING' || t.driverId !== null) return null;
        return tx.trip.update({ where: { id: trip.id, status: 'PENDING', driverId: null }, data: { driverId: d1.driver!.id, status: 'ACCEPTED' } });
      });

      const r2 = await prisma.$transaction(async (tx) => {
        const t = await tx.trip.findUnique({ where: { id: trip.id } });
        if (t?.status !== 'PENDING' || t.driverId !== null) return null;
        return tx.trip.update({ where: { id: trip.id, status: 'PENDING', driverId: null }, data: { driverId: d2.driver!.id, status: 'ACCEPTED' } });
      });

      expect(r1).not.toBeNull();
      expect(r1!.driverId).toBe(d1.driver!.id);
      expect(r2).toBeNull();
    });
  });

  describe('Driver Actions', () => {
    it('increments totalTrips on completion', async () => {
      const d = await createTestDriver({ email: `${u('e')}@t.com`, driverId: u('D'), isOnline: true });
      await prisma.driver.update({ where: { id: d.driver!.id }, data: { totalTrips: { increment: 1 } } });
      const updated = await prisma.driver.findUnique({ where: { id: d.driver!.id } });
      expect(updated!.totalTrips).toBe(1);
    });
  });
});
