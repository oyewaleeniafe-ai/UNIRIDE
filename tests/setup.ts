import { PrismaClient } from '../node_modules/.prisma/test-client';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = path.resolve(__dirname, 'test.db');

const basePrisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:${dbPath}`,
    },
  },
});

/**
 * The SQLite connector has no native `Json` type, so the test schema stores
 * `AuditLog.details` as a String while production uses `Json`. Without this
 * extension every audit write would fail silently (the audit helper swallows
 * its own errors) and the audit trail would be empty in tests.
 *
 * The extension serialises the object to JSON exactly like the production
 * `Json` column would store it, so assertions can parse it back.
 */
const prisma = basePrisma.$extends({
  query: {
    auditLog: {
      async create({ args, query }) {
        const data = args.data as { details?: unknown };
        if (data && typeof data.details === 'object' && data.details !== null) {
          args.data = {
            ...data,
            details: JSON.stringify(data.details),
          } as typeof args.data;
        }
        return query(args);
      },
    },
  },
});

export { prisma };

/**
 * Clean all tables in the correct order (respect foreign keys).
 */
export async function cleanDatabase() {
  await prisma.commissionLedgerEntry.deleteMany();
  await prisma.commissionSettlement.deleteMany();
  await prisma.driverEarning.deleteMany();
  await prisma.commissionConfig.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.payout.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.driverPaymentAccount.deleteMany();
  await prisma.rating.deleteMany();
  await prisma.rideStatusHistory.deleteMany();
  await prisma.safetyAlert.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.tripPassenger.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.vehicleInspection.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.student.deleteMany();
  await prisma.userPreference.deleteMany();
  await prisma.user.deleteMany();
  await prisma.campusLocation.deleteMany();
}

/**
 * Create a test student user.
 */
export async function createTestStudent(overrides?: { email?: string; matricNo?: string; name?: string }) {
  const passwordHash = await bcrypt.hash('password123', 4);
  const email = overrides?.email || `student-${Date.now()}@test.com`;

  const user = await prisma.user.create({
    data: {
      email,
      name: overrides?.name || 'Test Student',
      phone: '08012345678',
      passwordHash,
      role: 'STUDENT',
      student: {
        create: {
          matricNo: overrides?.matricNo || `MAT-${Date.now()}`,
        },
      },
    },
    include: { student: true },
  });

  return user;
}

/**
 * Create a test driver user with a vehicle.
 */
export async function createTestDriver(overrides?: { email?: string; driverId?: string; name?: string; isOnline?: boolean }) {
  const passwordHash = await bcrypt.hash('password123', 4);
  const email = overrides?.email || `driver-${Date.now()}@test.com`;

  const user = await prisma.user.create({
    data: {
      email,
      name: overrides?.name || 'Test Driver',
      phone: '08087654321',
      passwordHash,
      role: 'DRIVER',
      driver: {
        create: {
          driverId: overrides?.driverId || `DRV-${Date.now()}`,
          isOnline: overrides?.isOnline ?? true,
          vehicle: {
            create: {
              make: 'Toyota',
              model: 'Corolla',
              color: 'Silver',
              licensePlate: `ABC-${Date.now() % 10000}`,
            },
          },
        },
      },
    },
    include: { driver: { include: { vehicle: true } } },
  });

  return user;
}

/**
 * Get or create a campus location for tests.
 */
export async function getTestLocation(name: string) {
  return prisma.campusLocation.upsert({
    where: { name },
    update: {},
    create: { name },
  });
}
