import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, isAdmin } from '@/lib/commission/authz';
import {
  getCommissionByDay,
  getCommissionByDriver,
  getSchoolDaySummary,
  getSchoolGlobalSummary,
} from '@/lib/commission/daily';
import { getCommissionConfig } from '@/lib/commission/config';
import { businessDayKey, dayKeyToIso, isoToDayKey } from '@/lib/commission/time';

export const runtime = 'nodejs';

/**
 * GET /api/commission/summary?day=YYYY-MM-DD
 *
 * School-wide commission metrics for the admin dashboard:
 * global totals, one business day (default today), commission by day and
 * commission by driver. ADMIN only — enforced here, not in the UI.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'School administrators only.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const dayParam = searchParams.get('day');
  const config = await getCommissionConfig();

  let key: Date | undefined;
  if (dayParam) {
    try {
      key = isoToDayKey(dayParam);
    } catch {
      return NextResponse.json({ error: 'Invalid day (expected YYYY-MM-DD).' }, { status: 400 });
    }
  } else {
    key = businessDayKey(new Date(), config.businessTimezone);
  }

  const [global, day, byDay, byDriver] = await Promise.all([
    getSchoolGlobalSummary(),
    getSchoolDaySummary(key),
    getCommissionByDay(),
    getCommissionByDriver(dayKeyToIso(key)),
  ]);

  return NextResponse.json({
    global,
    day,
    byDay,
    byDriver,
    config: {
      commissionRateBps: config.commissionRateBps,
      businessTimezone: config.businessTimezone,
      autoSettlementEnabled: config.autoSettlementEnabled,
      manualApprovalRequired: config.manualApprovalRequired,
      minSettlementKobo: config.minSettlementKobo,
      recipientConfigured: Boolean(config.recipientBankCode && config.recipientAccountNumber),
      updatedAt: config.updatedAt,
    },
  });
}
