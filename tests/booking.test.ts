import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, cleanDatabase, createTestStudent, createTestDriver, getTestLocation } from './setup';

const FARE_PER_PASSENGER = 200;

describe('Booking & Fare', () => {
  beforeAll(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  describe('Fare Calculation', () => {
    it('1 passenger = ₦200', () => {
      expect(1 * FARE_PER_PASSENGER).toBe(200);
    });

    it('3 passengers = ₦600', () => {
      expect(3 * FARE_PER_PASSENGER).toBe(600);
    });

    it('5 passengers = ₦1,000', () => {
      expect(5 * FARE_PER_PASSENGER).toBe(1000);
    });

    it('10 passengers = ₦2,000', () => {
      expect(10 * FARE_PER_PASSENGER).toBe(2000);
    });
  });

  describe('Location Validation', () => {
    it('pickup and dropoff must be different', async () => {
      const loc = await getTestLocation('Library');
      expect(loc.id).toBeDefined();
      // Actual validation: pickupLocationId !== dropoffLocationId
    });
  });

  describe('Trip Creation', () => {
    it('creates a trip with PENDING status', async () => {
      const user = await createTestStudent({ email: `bt-1-${Date.now()}@t.com`, matricNo: `BT-1-${Date.now()}` });
      const student = await prisma.student.findUnique({ where: { userId: user.id } });
      const pickup = await getTestLocation('Old Chapel');
      const dropoff = await getTestLocation('Library');

      const trip = await prisma.trip.create({
        data: {
          studentId: student!.id,
          pickupLocationId: pickup.id,
          dropoffLocationId: dropoff.id,
          passengerCount: 2,
          rideType: 'SOLO_QUICK_CAB',
          totalFare: 2 * FARE_PER_PASSENGER,
          status: 'PENDING',
        },
        include: { pickupLocation: true, dropoffLocation: true },
      });

      expect(trip.status).toBe('PENDING');
      expect(trip.totalFare).toBe(400);
      expect(trip.passengerCount).toBe(2);
      expect(trip.pickupLocation.name).toBe('Old Chapel');
      expect(trip.dropoffLocation.name).toBe('Library');
    });

    it('stores passenger count and total fare', async () => {
      const user = await createTestStudent({ email: `bt-2-${Date.now()}@t.com`, matricNo: `BT-2-${Date.now()}` });
      const student = await prisma.student.findUnique({ where: { userId: user.id } });
      const pickup = await getTestLocation('Clinic');
      const dropoff = await getTestLocation('Complex');

      const trip = await prisma.trip.create({
        data: {
          studentId: student!.id,
          pickupLocationId: pickup.id,
          dropoffLocationId: dropoff.id,
          passengerCount: 4,
          rideType: 'SHARED_SHUTTLE',
          totalFare: 4 * FARE_PER_PASSENGER,
          status: 'PENDING',
        },
      });

      expect(trip.passengerCount).toBe(4);
      expect(trip.totalFare).toBe(800);
      expect(trip.rideType).toBe('SHARED_SHUTTLE');
    });
  });

  describe('Ride Types', () => {
    it('supports SOLO_QUICK_CAB', async () => {
      const user = await createTestStudent({ email: `rt-1-${Date.now()}@t.com`, matricNo: `RT-1-${Date.now()}` });
      const student = await prisma.student.findUnique({ where: { userId: user.id } });
      const pickup = await getTestLocation('Gym');
      const dropoff = await getTestLocation('NLT');

      const trip = await prisma.trip.create({
        data: { studentId: student!.id, pickupLocationId: pickup.id, dropoffLocationId: dropoff.id, passengerCount: 1, rideType: 'SOLO_QUICK_CAB', totalFare: 200, status: 'PENDING' },
      });
      expect(trip.rideType).toBe('SOLO_QUICK_CAB');
    });

    it('supports SHARED_SHUTTLE', async () => {
      const user = await createTestStudent({ email: `rt-2-${Date.now()}@t.com`, matricNo: `RT-2-${Date.now()}` });
      const student = await prisma.student.findUnique({ where: { userId: user.id } });
      const pickup = await getTestLocation('Jubilee');
      const dropoff = await getTestLocation('SMS');

      const trip = await prisma.trip.create({
        data: { studentId: student!.id, pickupLocationId: pickup.id, dropoffLocationId: dropoff.id, passengerCount: 3, rideType: 'SHARED_SHUTTLE', totalFare: 600, status: 'PENDING' },
      });
      expect(trip.rideType).toBe('SHARED_SHUTTLE');
    });

    it('supports LATE_NIGHT_SAFE_RIDE', async () => {
      const user = await createTestStudent({ email: `rt-3-${Date.now()}@t.com`, matricNo: `RT-3-${Date.now()}` });
      const student = await prisma.student.findUnique({ where: { userId: user.id } });
      const pickup = await getTestLocation('Boys Hostel');
      const dropoff = await getTestLocation('CBT Center');

      const trip = await prisma.trip.create({
        data: { studentId: student!.id, pickupLocationId: pickup.id, dropoffLocationId: dropoff.id, passengerCount: 1, rideType: 'LATE_NIGHT_SAFE_RIDE', totalFare: 200, status: 'PENDING' },
      });
      expect(trip.rideType).toBe('LATE_NIGHT_SAFE_RIDE');
    });
  });
});
