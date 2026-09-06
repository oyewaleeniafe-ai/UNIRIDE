import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma, cleanDatabase, createTestStudent } from './setup';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { forgotPasswordSchema, resetPasswordSchema } from '@/lib/validations';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

// ─── Validation Tests ───────────────────────────────

describe('Password Reset — Validation', () => {
  describe('forgotPasswordSchema', () => {
    it('should accept a valid email', () => {
      const result = forgotPasswordSchema.safeParse({ contact: 'user@test.com' });
      expect(result.success).toBe(true);
    });

    it('should accept a valid phone number', () => {
      const result = forgotPasswordSchema.safeParse({ contact: '08012345678' });
      expect(result.success).toBe(true);
    });

    it('should reject empty contact', () => {
      const result = forgotPasswordSchema.safeParse({ contact: '' });
      expect(result.success).toBe(false);
    });

    it('should reject missing contact field', () => {
      const result = forgotPasswordSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('resetPasswordSchema', () => {
    it('should accept valid token and matching passwords', () => {
      const result = resetPasswordSchema.safeParse({
        token: 'abc123',
        password: 'newpassword123',
        confirmPassword: 'newpassword123',
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty token', () => {
      const result = resetPasswordSchema.safeParse({
        token: '',
        password: 'newpassword123',
        confirmPassword: 'newpassword123',
      });
      expect(result.success).toBe(false);
    });

    it('should reject password shorter than 8 characters', () => {
      const result = resetPasswordSchema.safeParse({
        token: 'abc123',
        password: 'short',
        confirmPassword: 'short',
      });
      expect(result.success).toBe(false);
    });

    it('should reject when passwords do not match', () => {
      const result = resetPasswordSchema.safeParse({
        token: 'abc123',
        password: 'newpassword123',
        confirmPassword: 'differentpassword',
      });
      expect(result.success).toBe(false);
    });
  });
});

// ─── Token Lifecycle Tests ──────────────────────────

describe('Password Reset — Token Lifecycle', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await prisma.$disconnect();
  });

  it('should create a password reset token for a valid user', async () => {
    const user = await createTestStudent({ email: 'reset-create@test.com', matricNo: 'RST-001' });
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const resetToken = await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        method: 'email',
        contact: 'reset-create@test.com',
        expiresAt,
      },
    });

    expect(resetToken).toBeDefined();
    expect(resetToken.token).toBe(token);
    expect(resetToken.method).toBe('email');
    expect(resetToken.usedAt).toBeNull();
    expect(resetToken.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('should find a valid unused token by token string', async () => {
    const user = await createTestStudent({ email: 'reset-find@test.com', matricNo: 'RST-002' });
    const token = crypto.randomBytes(32).toString('hex');

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        method: 'email',
        contact: 'reset-find@test.com',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const found = await prisma.passwordResetToken.findUnique({ where: { token } });
    expect(found).not.toBeNull();
    expect(found!.userId).toBe(user.id);
    expect(found!.usedAt).toBeNull();
  });

  it('should return null for a non-existent token', async () => {
    const found = await prisma.passwordResetToken.findUnique({ where: { token: 'nonexistent' } });
    expect(found).toBeNull();
  });

  it('should detect an expired token', async () => {
    const user = await createTestStudent({ email: 'reset-expired@test.com', matricNo: 'RST-003' });
    const token = crypto.randomBytes(32).toString('hex');

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        method: 'email',
        contact: 'reset-expired@test.com',
        expiresAt: new Date(Date.now() - 1000), // already expired
      },
    });

    const found = await prisma.passwordResetToken.findUnique({ where: { token } });
    expect(found).not.toBeNull();
    expect(new Date() > found!.expiresAt).toBe(true);
  });

  it('should mark token as used after password reset', async () => {
    const user = await createTestStudent({ email: 'reset-used@test.com', matricNo: 'RST-004' });
    const token = crypto.randomBytes(32).toString('hex');

    const resetToken = await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        method: 'email',
        contact: 'reset-used@test.com',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    // Simulate marking as used
    await prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    });

    const found = await prisma.passwordResetToken.findUnique({ where: { token } });
    expect(found!.usedAt).not.toBeNull();
  });

  it('should invalidate previous unused tokens when a new one is created', async () => {
    const user = await createTestStudent({ email: 'reset-invalidate@test.com', matricNo: 'RST-005' });

    // Create first token
    const token1 = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: token1,
        method: 'email',
        contact: 'reset-invalidate@test.com',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    // Invalidate all unused tokens for this user (as the server action does)
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    // Create second token
    const token2 = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: token2,
        method: 'email',
        contact: 'reset-invalidate@test.com',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    // First token should be marked as used
    const t1 = await prisma.passwordResetToken.findUnique({ where: { token: token1 } });
    expect(t1!.usedAt).not.toBeNull();

    // Second token should still be unused
    const t2 = await prisma.passwordResetToken.findUnique({ where: { token: token2 } });
    expect(t2!.usedAt).toBeNull();
  });

  it('should enforce unique token constraint', async () => {
    const user = await createTestStudent({ email: 'reset-unique@test.com', matricNo: 'RST-006' });
    const token = crypto.randomBytes(32).toString('hex');

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        method: 'email',
        contact: 'reset-unique@test.com',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await expect(
      prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          token, // duplicate
          method: 'email',
          contact: 'reset-unique@test.com',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      })
    ).rejects.toThrow();
  });
});

// ─── Password Update Tests ──────────────────────────

describe('Password Reset — Password Update', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await prisma.$disconnect();
  });

  it('should update the password hash after reset', async () => {
    const user = await createTestStudent({ email: 'reset-pwd@test.com', matricNo: 'PWD-001' });
    const originalHash = user.passwordHash;
    const newPassword = 'brandnewpassword123';
    const newHash = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser!.passwordHash).not.toBe(originalHash);

    // New password should verify
    const valid = await bcrypt.compare(newPassword, updatedUser!.passwordHash);
    expect(valid).toBe(true);

    // Old password should not verify
    const oldValid = await bcrypt.compare('password123', updatedUser!.passwordHash);
    expect(oldValid).toBe(false);
  });

  it('should update password and mark token as used in a transaction', async () => {
    const user = await createTestStudent({ email: 'reset-txn@test.com', matricNo: 'TXN-001' });
    const token = crypto.randomBytes(32).toString('hex');
    const newPassword = 'transactiontest999';
    const newHash = await bcrypt.hash(newPassword, 12);

    const resetToken = await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        method: 'email',
        contact: 'reset-txn@test.com',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    // Simulate the transaction from the server action
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    // Verify password was updated
    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    const valid = await bcrypt.compare(newPassword, updatedUser!.passwordHash);
    expect(valid).toBe(true);

    // Verify token was marked as used
    const usedToken = await prisma.passwordResetToken.findUnique({ where: { id: resetToken.id } });
    expect(usedToken!.usedAt).not.toBeNull();
  });

  it('should not allow password reset with an already-used token', async () => {
    const user = await createTestStudent({ email: 'reset-already@test.com', matricNo: 'ALR-001' });
    const token = crypto.randomBytes(32).toString('hex');

    const resetToken = await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        method: 'email',
        contact: 'reset-already@test.com',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    // Mark as used
    await prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    });

    // Try to find and use it again
    const found = await prisma.passwordResetToken.findUnique({ where: { token } });
    const isUsed = found!.usedAt !== null;
    expect(isUsed).toBe(true);
  });

  it('should not allow password reset with an expired token', async () => {
    const user = await createTestStudent({ email: 'reset-exp2@test.com', matricNo: 'EXP-001' });
    const token = crypto.randomBytes(32).toString('hex');

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        method: 'email',
        contact: 'reset-exp2@test.com',
        expiresAt: new Date(Date.now() - 1000), // expired
      },
    });

    const found = await prisma.passwordResetToken.findUnique({ where: { token } });
    expect(found).not.toBeNull();
    const isExpired = new Date() > found!.expiresAt;
    expect(isExpired).toBe(true);
  });

  it('should allow different users to have independent reset tokens', async () => {
    const user1 = await createTestStudent({ email: 'reset-user1@test.com', matricNo: 'USR-001' });
    const user2 = await createTestStudent({ email: 'reset-user2@test.com', matricNo: 'USR-002' });

    const token1 = crypto.randomBytes(32).toString('hex');
    const token2 = crypto.randomBytes(32).toString('hex');

    await prisma.passwordResetToken.create({
      data: {
        userId: user1.id,
        token: token1,
        method: 'email',
        contact: 'reset-user1@test.com',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await prisma.passwordResetToken.create({
      data: {
        userId: user2.id,
        token: token2,
        method: 'phone',
        contact: '08099999999',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const found1 = await prisma.passwordResetToken.findUnique({ where: { token: token1 } });
    const found2 = await prisma.passwordResetToken.findUnique({ where: { token: token2 } });

    expect(found1!.userId).toBe(user1.id);
    expect(found1!.method).toBe('email');
    expect(found2!.userId).toBe(user2.id);
    expect(found2!.method).toBe('phone');
  });

  it('should clean up old tokens when user requests a new reset', async () => {
    const user = await createTestStudent({ email: 'reset-cleanup@test.com', matricNo: 'CLN-001' });

    // Create an old token
    const oldToken = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: oldToken,
        method: 'email',
        contact: 'reset-cleanup@test.com',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    // Invalidate old unused tokens (simulating the server action)
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    // Create a new token
    const newToken = crypto.randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: newToken,
        method: 'email',
        contact: 'reset-cleanup@test.com',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    // Old token should be marked as used
    const old = await prisma.passwordResetToken.findUnique({ where: { token: oldToken } });
    expect(old!.usedAt).not.toBeNull();

    // New token should be unused
    const fresh = await prisma.passwordResetToken.findUnique({ where: { token: newToken } });
    expect(fresh!.usedAt).toBeNull();

    // Total tokens for this user should be 2
    const count = await prisma.passwordResetToken.count({ where: { userId: user.id } });
    expect(count).toBe(2);
  });
});

// ─── Rate Limiting Tests ────────────────────────────

describe('Password Reset — Rate Limiting', () => {
  it('should allow requests within the limit', () => {
    const id = `rl-test-${Date.now()}`;
    const result1 = checkRateLimit(id, RATE_LIMITS.passwordReset);
    expect(result1.allowed).toBe(true);

    const result2 = checkRateLimit(id, RATE_LIMITS.passwordReset);
    expect(result2.allowed).toBe(true);

    const result3 = checkRateLimit(id, RATE_LIMITS.passwordReset);
    expect(result3.allowed).toBe(true);
  });

  it('should block requests exceeding the limit', () => {
    const id = `rl-block-${Date.now()}`;
    // Exhaust the limit (3 requests)
    checkRateLimit(id, RATE_LIMITS.passwordReset);
    checkRateLimit(id, RATE_LIMITS.passwordReset);
    checkRateLimit(id, RATE_LIMITS.passwordReset);

    // 4th should be blocked
    const result = checkRateLimit(id, RATE_LIMITS.passwordReset);
    expect(result.allowed).toBe(false);
  });
});
