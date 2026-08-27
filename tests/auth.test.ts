import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, cleanDatabase, createTestStudent, createTestDriver } from './setup';
import bcrypt from 'bcryptjs';

describe('Authentication', () => {
  beforeAll(async () => {
    await cleanDatabase();
    // Seed campus locations
    const locations = ['Old Chapel', 'Library', 'Clinic'];
    for (const name of locations) {
      await prisma.campusLocation.upsert({ where: { name }, update: {}, create: { name } });
    }
  });

  afterAll(async () => {
    await cleanDatabase();
    await prisma.$disconnect();
  });

  describe('Student Registration', () => {
    it('should create a student user with correct fields', async () => {
      const user = await createTestStudent({
        email: 'student-reg@test.com',
        matricNo: 'STU-001',
        name: 'Alice Student',
      });

      expect(user).toBeDefined();
      expect(user.email).toBe('student-reg@test.com');
      expect(user.name).toBe('Alice Student');
      expect(user.role).toBe('STUDENT');
      expect(user.student).toBeDefined();
      expect(user.student?.matricNo).toBe('STU-001');
    });

    it('should hash passwords properly', async () => {
      const user = await createTestStudent({ email: 'student-pwd@test.com', matricNo: 'STU-002' });
      expect(user.passwordHash).not.toBe('password123');
      const valid = await bcrypt.compare('password123', user.passwordHash);
      expect(valid).toBe(true);
    });

    it('should enforce unique email', async () => {
      await createTestStudent({ email: 'student-unique@test.com', matricNo: 'STU-003' });
      await expect(
        createTestStudent({ email: 'student-unique@test.com', matricNo: 'STU-004' })
      ).rejects.toThrow();
    });

    it('should enforce unique matric number', async () => {
      await createTestStudent({ email: 'student-mat1@test.com', matricNo: 'STU-005' });
      await expect(
        createTestStudent({ email: 'student-mat2@test.com', matricNo: 'STU-005' })
      ).rejects.toThrow();
    });
  });

  describe('Driver Registration', () => {
    it('should create a driver user with vehicle', async () => {
      const user = await createTestDriver({
        email: 'driver-reg@test.com',
        driverId: 'DRV-001',
        name: 'Bob Driver',
      });

      expect(user).toBeDefined();
      expect(user.email).toBe('driver-reg@test.com');
      expect(user.role).toBe('DRIVER');
      expect(user.driver).toBeDefined();
      expect(user.driver?.driverId).toBe('DRV-001');
      expect(user.driver?.vehicle).toBeDefined();
      expect(user.driver?.vehicle?.make).toBe('Toyota');
    });

    it('should enforce unique driver ID', async () => {
      await createTestDriver({ email: 'driver-uniq1@test.com', driverId: 'DRV-002' });
      await expect(
        createTestDriver({ email: 'driver-uniq2@test.com', driverId: 'DRV-002' })
      ).rejects.toThrow();
    });
  });

  describe('Login Verification', () => {
    it('should verify correct password', async () => {
      const user = await createTestStudent({ email: 'student-login@test.com', matricNo: 'STU-LOGIN' });
      const valid = await bcrypt.compare('password123', user.passwordHash);
      expect(valid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const user = await createTestStudent({ email: 'student-wrong@test.com', matricNo: 'STU-WRONG' });
      const valid = await bcrypt.compare('wrongpassword', user.passwordHash);
      expect(valid).toBe(false);
    });
  });

  describe('Role Protection', () => {
    it('student user should have STUDENT role', async () => {
      const student = await createTestStudent({ email: 'role-stu@test.com', matricNo: 'ROLE-STU' });
      expect(student.role).toBe('STUDENT');
    });

    it('driver user should have DRIVER role', async () => {
      const driver = await createTestDriver({ email: 'role-drv@test.com', driverId: 'ROLE-DRV' });
      expect(driver.role).toBe('DRIVER');
    });

    it('student should not have driver record', async () => {
      const student = await createTestStudent({ email: 'no-drv@test.com', matricNo: 'NO-DRV' });
      const driver = await prisma.driver.findUnique({ where: { userId: student.id } });
      expect(driver).toBeNull();
    });

    it('driver should not have student record', async () => {
      const driver = await createTestDriver({ email: 'no-stu@test.com', driverId: 'NO-STU' });
      const student = await prisma.student.findUnique({ where: { userId: driver.id } });
      expect(student).toBeNull();
    });
  });
});
