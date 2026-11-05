import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser, isDriver } from '@/lib/commission/authz';
import {
  getDriverDaySummary,
  getDriverEarningRows,
} from '@/lib/commission/daily';
import { getCommissionConfig } from '@/lib/commission/config';
import { businessDayKey, isoToDayKey } from '@/lib/commission/time';

export const runtime = 'nodejs';

/**
 * GET /api/commission/driver?day=YYYY-MM-DD
 *
 * The signed-in driver's own earnings summary + per-ride breakdown.
 * Drivers can never address another driver's records (the driver id comes
 * from the session, never from the query string).
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isDriver(user)) {
    return NextResponse.json({ error: 'Only drivers can view earnings.' }, { status: 403 });
  }

  const driver = await prisma.driver.findUnique({ where: { userId: user.id } });
  if (!driver) {
    return NextResponse.json({ error: 'Driver profile not found.' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const dayParam = searchParams.get('day');
  const config = await getCommissionConfig();

  let key: Date;
  if (dayParam) {
    try {
      key = isoToDayKey(dayParam);
    } catch {
      return NextResponse.json({ error: 'Invalid day (expected YYYY-MM-DD).' }, { status: 400 });
    }
  } else {
    key = businessDayKey(new Date(), config.businessTimezone);
  }

  const [summary, rows] = await Promise.all([
    getDriverDaySummary(driver.id, key),
    getDriverEarningRows(driver.id, dayParam ? { dayIso: dayParam } : undefined),
  ]);

  return NextResponse.json({
    summary,
    rows,
    commissionRateBps: summary.commissionRateBps,
  });
}
