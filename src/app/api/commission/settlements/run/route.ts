import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getSessionUser, isAdmin } from '@/lib/commission/authz';
import { runSettlementCycle } from '@/lib/commission/settlements';

export const runtime = 'nodejs';

/**
 * Settlement job endpoint.
 *
 *  GET  — scheduled execution (Vercel Cron). Authenticated by the platform's
 *         automatic `Authorization: Bearer ${CRON_SECRET}` header, or an
 *         `x-settlement-secret: ${COMMISSION_SETTLEMENT_SECRET}` header for
 *         external schedulers. Runs the full cycle: backfill → reconcile →
 *         prepare → initiate only when auto settlement is enabled AND manual
 *         approval is not required.
 *
 *  POST — manual execution by an authorized administrator (same cycle, and
 *         manual runs may initiate transfers regardless of the auto flag).
 *
 * Repeated executions are always safe: the settlement idempotency key and the
 * "no new transfer while one is unresolved" guard prevent duplicates.
 */

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

async function isAuthorizedCron(request: NextRequest): Promise<boolean> {
  const secrets = [
    process.env.CRON_SECRET,
    process.env.COMMISSION_SETTLEMENT_SECRET,
  ].filter((s): s is string => Boolean(s));
  if (secrets.length === 0) return false;

  const authHeader = request.headers.get('authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const headerSecret = request.headers.get('x-settlement-secret') ?? '';

  return secrets.some(
    (secret) =>
      (bearer && constantTimeEquals(bearer, secret)) ||
      (headerSecret && constantTimeEquals(headerSecret, secret))
  );
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorizedCron(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cycle = await runSettlementCycle({ trigger: 'cron' });
  return NextResponse.json({ ok: cycle.ran, ...cycle });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'School administrators only.' }, { status: 403 });
  }

  let body: { dayIso?: string } = {};
  try {
    body = (await request.json()) as { dayIso?: string };
  } catch {
    body = {};
  }
  if (body.dayIso && !/^\d{4}-\d{2}-\d{2}$/.test(body.dayIso)) {
    return NextResponse.json({ error: 'Invalid dayIso (expected YYYY-MM-DD).' }, { status: 400 });
  }

  const cycle = await runSettlementCycle({
    dayIso: body.dayIso,
    actorUserId: user.id,
    trigger: 'manual',
  });
  return NextResponse.json({ ok: cycle.ran, ...cycle });
}
