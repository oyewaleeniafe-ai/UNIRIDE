import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { getSessionUser, isAdmin } from '@/lib/commission/authz';
import { dayKeyToIso } from '@/lib/commission/time';

export const runtime = 'nodejs';

/**
 * GET /api/commission/settlements?status=&page=&pageSize=
 *
 * Settlement history for the admin dashboard: period, amount, masked
 * destination, Flutterwave transfer reference, transfer status, timestamps,
 * safe failure reason and reconciliation status.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'School administrators only.' }, { status: 403 });
  }

  const { searchParams: params } = new URL(request.url);
  const status = params.get('status');
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const pageSize = Math.min(100, Math.max(1, Number(params.get('pageSize') ?? '25') || 25));

  const ALLOWED = ['PREPARED', 'TRANSFERRING', 'SUCCESSFUL', 'FAILED', 'BLOCKED', 'CANCELLED'] as const;
  type SettlementStatusValue = (typeof ALLOWED)[number];
  const where: Prisma.CommissionSettlementWhereInput = status
    ? (ALLOWED as readonly string[]).includes(status)
      ? { transferStatus: status as SettlementStatusValue }
      : // Unknown status value → no matches (never widen the filter silently).
        { transferStatus: { in: [] as SettlementStatusValue[] } }
    : {};

  const [total, settlements] = await Promise.all([
    prisma.commissionSettlement.count({ where }),
    prisma.commissionSettlement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { entries: true } } },
    }),
  ]);

  return NextResponse.json({
    total,
    page,
    pageSize,
    settlements: settlements.map((s) => ({
      id: s.id,
      reference: s.reference,
      periodDate: dayKeyToIso(s.periodDate),
      totalAmountKobo: s.totalAmountKobo,
      entryCount: s.entryCount,
      ledgerEntryCount: s._count.entries,
      // Already masked at creation time — no raw account number in responses.
      recipientLabel: s.recipientLabel,
      provider: s.provider,
      providerReference: s.providerReference,
      transferStatus: s.transferStatus,
      reconciliationStatus: s.reconciliationStatus,
      failureReason: s.failureReason,
      initiatedAt: s.initiatedAt,
      confirmedAt: s.confirmedAt,
      failedAt: s.failedAt,
      createdAt: s.createdAt,
    })),
  });
}
