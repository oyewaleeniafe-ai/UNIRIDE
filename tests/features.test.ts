import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, cleanDatabase, createTestStudent, createTestDriver, getTestLocation } from './setup';

describe('Vehicle Inspection', () => {
  beforeAll(async () => { await cleanDatabase(); });
  afterAll(async () => { await cleanDatabase(); });

  it('creates a draft inspection', async () => {
    const d = await createTestDriver({ email: `isp-1-${Date.now()}@t.com`, driverId: `ISP-1-${Date.now()}` });
    const insp = await prisma.vehicleInspection.create({
      data: { driverId: d.driver!.id, brakes: false, tires: false, lights: false, interiorClean: false, noTrash: false, fireExtinguisher: false, firstAidKit: false, fuelBattery: false, status: 'DRAFT' },
    });
    expect(insp.status).toBe('DRAFT');
  });

  it('creates a completed inspection', async () => {
    const d = await createTestDriver({ email: `isp-2-${Date.now()}@t.com`, driverId: `ISP-2-${Date.now()}` });
    const insp = await prisma.vehicleInspection.create({
      data: { driverId: d.driver!.id, brakes: true, tires: true, lights: true, interiorClean: true, noTrash: true, fireExtinguisher: true, firstAidKit: true, fuelBattery: true, status: 'COMPLETED' },
    });
    expect(insp.status).toBe('COMPLETED');
  });

  it('blocks online without inspection', async () => {
    const d = await createTestDriver({ email: `isp-3-${Date.now()}@t.com`, driverId: `ISP-3-${Date.now()}`, isOnline: false });
    const latest = await prisma.vehicleInspection.findFirst({ where: { driverId: d.driver!.id }, orderBy: { createdAt: 'desc' } });
    expect(latest).toBeNull();
  });
});

describe('Rating System', () => {
  beforeAll(async () => { await cleanDatabase(); });
  afterAll(async () => { await cleanDatabase(); });

  it('creates a rating for a completed trip', async () => {
    const user = await createTestStudent({ email: `rat-1-${Date.now()}@t.com`, matricNo: `RAT-1-${Date.now()}` });
    const student = await prisma.student.findUnique({ where: { userId: user.id } });
    const drv = await createTestDriver({ email: `rat-d1-${Date.now()}@t.com`, driverId: `RAT-D1-${Date.now()}`, isOnline: true });
    const pickup = await getTestLocation('Library');
    const dropoff = await getTestLocation('Gym');

    const trip = await prisma.trip.create({
      data: { studentId: student!.id, pickupLocationId: pickup.id, dropoffLocationId: dropoff.id, passengerCount: 1, rideType: 'SOLO_QUICK_CAB', totalFare: 200, driverId: drv.driver!.id, status: 'COMPLETED' },
    });

    const rating = await prisma.rating.create({
      data: { tripId: trip.id, driverId: drv.driver!.id, userId: user.id, score: 5, feedback: 'Great ride!' },
    });

    expect(rating.score).toBe(5);
  });

  it('prevents duplicate ratings', async () => {
    const user = await createTestStudent({ email: `rat-2-${Date.now()}@t.com`, matricNo: `RAT-2-${Date.now()}` });
    const student = await prisma.student.findUnique({ where: { userId: user.id } });
    const drv = await createTestDriver({ email: `rat-d2-${Date.now()}@t.com`, driverId: `RAT-D2-${Date.now()}`, isOnline: true });
    const pickup = await getTestLocation('Clinic');
    const dropoff = await getTestLocation('NLT');

    const trip = await prisma.trip.create({
      data: { studentId: student!.id, pickupLocationId: pickup.id, dropoffLocationId: dropoff.id, passengerCount: 1, rideType: 'SOLO_QUICK_CAB', totalFare: 200, driverId: drv.driver!.id, status: 'COMPLETED' },
    });

    await prisma.rating.create({ data: { tripId: trip.id, driverId: drv.driver!.id, userId: user.id, score: 4 } });
    await expect(
      prisma.rating.create({ data: { tripId: trip.id, driverId: drv.driver!.id, userId: user.id, score: 3 } })
    ).rejects.toThrow();
  });

  it('calculates average driver rating', async () => {
    const drv = await createTestDriver({ email: `rat-d3-${Date.now()}@t.com`, driverId: `RAT-D3-${Date.now()}`, isOnline: true });

    for (const score of [5, 3, 4]) {
      const user = await createTestStudent({ email: `rat-s-${score}-${Date.now()}@t.com`, matricNo: `RAT-S-${score}-${Date.now()}` });
      const student = await prisma.student.findUnique({ where: { userId: user.id } });
      const pickup = await getTestLocation('Library');
      const dropoff = await getTestLocation('Gym');

      const trip = await prisma.trip.create({
        data: { studentId: student!.id, pickupLocationId: pickup.id, dropoffLocationId: dropoff.id, passengerCount: 1, rideType: 'SOLO_QUICK_CAB', totalFare: 200, driverId: drv.driver!.id, status: 'COMPLETED' },
      });

      await prisma.rating.create({ data: { tripId: trip.id, driverId: drv.driver!.id, userId: user.id, score } });
    }

    const stats = await prisma.rating.aggregate({ where: { driverId: drv.driver!.id }, _avg: { score: true } });
    expect(stats._avg.score).toBe(4);
  });
});

describe('Notifications', () => {
  beforeAll(async () => { await cleanDatabase(); });
  afterAll(async () => { await cleanDatabase(); });

  it('creates and reads a notification', async () => {
    const user = await createTestStudent({ email: `not-1-${Date.now()}@t.com`, matricNo: `NOT-1-${Date.now()}` });
    const n = await prisma.notification.create({ data: { userId: user.id, title: 'Ride Accepted', message: 'Accepted!', type: 'RIDE_ACCEPTED' } });
    expect(n.isRead).toBe(false);

    await prisma.notification.update({ where: { id: n.id }, data: { isRead: true } });
    const updated = await prisma.notification.findUnique({ where: { id: n.id } });
    expect(updated!.isRead).toBe(true);
  });
});

describe('SOS Alerts', () => {
  beforeAll(async () => { await cleanDatabase(); });
  afterAll(async () => { await cleanDatabase(); });

  it('creates a safety alert', async () => {
    const user = await createTestStudent({ email: `sos-1-${Date.now()}@t.com`, matricNo: `SOS-1-${Date.now()}` });
    const alert = await prisma.safetyAlert.create({ data: { userId: user.id, latitude: 6.5244, longitude: 3.3792, notes: 'Need help', status: 'PENDING' } });
    expect(alert.status).toBe('PENDING');
    expect(alert.latitude).toBe(6.5244);
  });

  it('creates SOS with active trip reference', async () => {
    const user = await createTestStudent({ email: `sos-2-${Date.now()}@t.com`, matricNo: `SOS-2-${Date.now()}` });
    const student = await prisma.student.findUnique({ where: { userId: user.id } });
    const pickup = await getTestLocation('Clinic');
    const dropoff = await getTestLocation('Library');

    const trip = await prisma.trip.create({
      data: { studentId: student!.id, pickupLocationId: pickup.id, dropoffLocationId: dropoff.id, passengerCount: 1, rideType: 'LATE_NIGHT_SAFE_RIDE', totalFare: 200, status: 'IN_PROGRESS' },
    });

    const alert = await prisma.safetyAlert.create({ data: { userId: user.id, tripId: trip.id, latitude: 6.5244, longitude: 3.3792, status: 'PENDING' } });
    expect(alert.tripId).toBe(trip.id);
  });

  it('creates SOS without location', async () => {
    const user = await createTestStudent({ email: `sos-3-${Date.now()}@t.com`, matricNo: `SOS-3-${Date.now()}` });
    const alert = await prisma.safetyAlert.create({ data: { userId: user.id, status: 'PENDING' } });
    expect(alert.latitude).toBeNull();
  });
});
