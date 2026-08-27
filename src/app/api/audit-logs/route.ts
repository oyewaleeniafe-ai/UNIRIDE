import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ logs: [] }, { status: 401 });
  }

  const ip = getClientIp(request.headers);
  const limit = checkRateLimit(ip, RATE_LIMITS.api);

  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)),
        },
      }
    );
  }

  const userId = (session.user as { id: string }).id;

  const logs = await prisma.auditLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  return NextResponse.json({ logs });
}
