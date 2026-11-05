import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { getSessionUser, isAdmin } from '@/lib/commission/authz';
import { dayKeyToIso } from '@/lib/commission/time';

export const runtime = 'nodejs';

/**
 * GET /api/commission/ledger?status=&driverId=&day=&page=&pageSize=
 *
 * Paginated commission ledger for the admin dashboard (searchable/filterable
 * per-entry view). Read-only: ledger entries are append-only and this route
 * exposes no way to edit totals.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'School administrators only.' }, { status: 403 });
  }

  const { searchParams: params } = new URL(request.url);
  const status = params.get('status');
  const driverId = params.get('driverId');
  const day = params.get('day');
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const pageSize = Math.min(200, Math.max(1, Number(params.get('pageSize') ?? '50') || 50));

  const STATUSES = ['OUTSTANDING', 'RESERVED', 'SETTLED', 'REVERSED'] as const;
  type LedgerStatus = (typeof STATUSES)[number];

  const where: Prisma.CommissionLedgerEntryWhereInput = {
    ...(status && (STATUSES as readonly string[]).includes(status)
      ? { status: status as LedgerStatus }
      : {}),
    ...(driverId ? { driverId } : {}),
    ...(day ? { periodDate: dayStart(day) } : {}),
  };

  const [total, entries] = await Promise.all([
    prisma.commissionLedgerEntry.count({ where }),
    prisma.commissionLedgerEntry.findMany({
      where,
      include: {
        driver: { select: { driverId: true, user: { select: { name: true } } } },
        earning: { select: { paymentReference: true, tripId: true, currency: true } },
        settlement: { select: { reference: true, transferStatus: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    total,
    page,
    pageSize,
    entries: entries.map((e) => ({
      id: e.id,
      driverId: e.driverId,
      driverName: e.driver?.user?.name ?? 'Unknown',
      driverCode: e.driver?.driverId ?? '',
      tripId: e.earning?.tripId ?? null,
      paymentReference: e.earning?.paymentReference ?? null,
      amountKobo: e.amountKobo,
      commissionRateBps: e.commissionRateBps,
      periodDate: dayKeyToIso(e.periodDate),
      entryType: e.entryType,
      status: e.status,
      note: e.note,
      settlementReference: e.settlement?.reference ?? null,
      settlementStatus: e.settlement?.transferStatus ?? null,
      createdAt: e.createdAt,
    })),
  });
}

function dayStart(day: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return undefined;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
