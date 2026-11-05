import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, isAdmin } from '@/lib/commission/authz';
import {
  commissionConfigSchema,
  getCommissionConfig,
  updateCommissionConfig,
} from '@/lib/commission/config';

export const runtime = 'nodejs';

/**
 * GET  /api/commission/config — read commission settings (ADMIN).
 * PATCH /api/commission/config — update settings (ADMIN), audit-logged.
 *
 * Bank details are server-side only; the response never exposes more than
 * the administrator themselves just configured, and audit entries never
 * include full account numbers.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'School administrators only.' }, { status: 403 });
  }

  const config = await getCommissionConfig();
  return NextResponse.json({ config });
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'School administrators only.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = commissionConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid configuration' },
      { status: 400 }
    );
  }

  const result = await updateCommissionConfig(parsed.data, user.id);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ config: result.config });
}
