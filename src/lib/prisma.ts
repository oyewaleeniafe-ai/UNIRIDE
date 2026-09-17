import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Prisma client singleton for serverless environments.
 *
 * In development (hot-reload), we reuse the client to avoid exhausting
 * database connections. In production on Vercel, each serverless function
 * gets its own module scope so this singleton pattern naturally limits
 * connections per instance.
 *
 * For Neon PostgreSQL, we rely on their built-in connection pooler
 * (pooler endpoint) if using the pooled connection string, or
 * Prisma's built-in connection management with the direct URL.
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    errorFormat: 'minimal',
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
