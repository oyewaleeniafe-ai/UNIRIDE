import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

export async function GET(request: Request) {
  const ip = getClientIp(request.headers);
  const limit = checkRateLimit(ip, RATE_LIMITS.api);

  const response = NextResponse.json({ locations: await prisma.campusLocation.findMany({ orderBy: { name: 'asc' } }) });

  response.headers.set('X-RateLimit-Limit', String(RATE_LIMITS.api.maxRequests));
  response.headers.set('X-RateLimit-Remaining', String(limit.remaining));
  response.headers.set('X-RateLimit-Reset', String(Math.ceil(limit.resetAt / 1000)));

  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(RATE_LIMITS.api.maxRequests),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(limit.resetAt / 1000)),
          'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)),
        },
      }
    );
  }

  return response;
}
