import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionUser, isAdmin } from '@/lib/commission/authz';
import {
  cancelSettlement,
  initiateSettlementTransfer,
  verifySettlement,
} from '@/lib/commission/settlements';
import { dayKeyToIso } from '@/lib/commission/time';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/commission/settlements/[id] — settlement detail (ADMIN).
 * POST /api/commission/settlements/[id] — { action: 'initiate' | 'verify' | 'cancel', reason? }
 *                                          admin-only settlement operations.
 *
 * 'initiate' refuses to run while another transfer is unresolved and requires
 * Flutterwave transfers to be enabled; 'verify' consults the Flutterwave
 * Transfers API and only marks the ledger settled on confirmed success.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'School administrators only.' }, { status: 403 });
  }

  const { id } = await params;
  const settlement = await prisma.commissionSettlement.findUnique({
    where: { id },
    include: {
      entries: {
        select: {
          id: true,
          amountKobo: true,
          status: true,
          periodDate: true,
          driverId: true,
        },
        orderBy: { periodDate: 'asc' },
        take: 500,
      },
    },
  });

  if (!settlement) {
    return NextResponse.json({ error: 'Settlement not found.' }, { status: 404 });
  }

  return NextResponse.json({
    settlement: {
      id: settlement.id,
      reference: settlement.reference,
      periodDate: dayKeyToIso(settlement.periodDate),
      totalAmountKobo: settlement.totalAmountKobo,
      entryCount: settlement.entryCount,
      recipientLabel: settlement.recipientLabel,
      provider: settlement.provider,
      providerReference: settlement.providerReference,
      transferStatus: settlement.transferStatus,
      reconciliationStatus: settlement.reconciliationStatus,
      failureReason: settlement.failureReason,
      initiatedAt: settlement.initiatedAt,
      confirmedAt: settlement.confirmedAt,
      failedAt: settlement.failedAt,
      createdAt: settlement.createdAt,
      entries: settlement.entries.map((e) => ({
        id: e.id,
        amountKobo: e.amountKobo,
        status: e.status,
        periodDate: dayKeyToIso(e.periodDate),
        driverId: e.driverId,
      })),
    },
  });
}

export async function POST(request: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'School administrators only.' }, { status: 403 });
  }

  const { id } = await params;

  let body: { action?: string; reason?: string };
  try {
    body = (await request.json()) as { action?: string; reason?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const existing = await prisma.commissionSettlement.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Settlement not found.' }, { status: 404 });
  }

  switch (body.action) {
    case 'initiate': {
      const initiated = await initiateSettlementTransfer(id, { actorUserId: user.id });
      if ('error' in initiated) {
        return NextResponse.json({ error: initiated.error }, { status: 400 });
      }
      const verify = await verifySettlement(id);
      return NextResponse.json({ ok: true, verify });
    }
    case 'verify': {
      const outcome = await verifySettlement(id);
      if ('error' in outcome) {
        return NextResponse.json({ error: outcome.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true, outcome });
    }
    case 'cancel': {
      const reason = (body.reason ?? '').trim();
      if (reason.length < 3) {
        return NextResponse.json({ error: 'A reason is required to cancel.' }, { status: 400 });
      }
      const outcome = await cancelSettlement(id, reason, user.id);
      if ('error' in outcome) {
        return NextResponse.json({ error: outcome.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json(
        { error: 'Unknown action. Use initiate, verify or cancel.' },
        { status: 400 }
      );
  }
}
