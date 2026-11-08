import { NextResponse } from 'next/server';
import { fail, json, readJson, requireAccount } from '@/lib/mobile/http';
import {
  driverSummary,
  getInspectionHistory,
  requestPayout,
  saveBankAccount,
  setOnline,
  submitInspection,
} from '@/lib/mobile/service';

export const dynamic = 'force-dynamic';

/** Driver home data: status, vehicle, inspection, earnings, active ride. */
export async function GET(request: Request) {
  const account = await requireAccount(request, ['DRIVER']);
  if (account instanceof NextResponse) return account;

  const result = await driverSummary(account);
  if ('error' in result) return fail(result.error ?? 'Request failed.', 404);

  const history = await getInspectionHistory(account);
  return json({
    ...result,
    inspections: 'inspections' in history ? history.inspections : [],
  });
}

/**
 * Driver actions:
 *  { action: 'online', online: boolean }
 *  { action: 'inspection', brakes, tires, ... }
 *  { action: 'bank', bankCode, accountNumber, accountName }
 *  { action: 'payout' }
 */
export async function POST(request: Request) {
  const account = await requireAccount(request, ['DRIVER']);
  if (account instanceof NextResponse) return account;

  const body = await readJson<Record<string, unknown>>(request);
  if (!body?.action) return fail('Missing action.', 400);

  switch (body.action) {
    case 'online': {
      if (typeof body.online !== 'boolean') return fail('online must be true or false.', 400);
      const result = await setOnline(account, body.online);
      return 'error' in result ? fail(result.error ?? 'Request failed.', 400) : json(result);
    }
    case 'inspection': {
      const { action, ...checklist } = body;
      void action;
      const result = await submitInspection(account, checklist);
      if ('error' in result) {
        // 409: saved, but not all items passed, so the driver stays offline.
        return json({ ...result }, result.inspection ? 409 : 400);
      }
      return json(result);
    }
    case 'bank': {
      const result = await saveBankAccount(account, body);
      return 'error' in result ? fail(result.error ?? 'Request failed.', 400) : json(result);
    }
    case 'payout': {
      const result = await requestPayout(account);
      return 'error' in result ? fail(result.error ?? 'Request failed.', 400) : json(result);
    }
    default:
      return fail('Unknown action.', 400);
  }
}
