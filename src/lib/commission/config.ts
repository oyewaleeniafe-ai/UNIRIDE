/**
 * School commission configuration (singleton row, id = 1).
 *
 * Defaults: 5% (500 bps), Africa/Lagos business day, automatic transfers
 * DISABLED until explicitly enabled by an authorized administrator.
 *
 * All changes go through updateCommissionConfig which validates input,
 * restricts the caller to admins, and writes an audit trail.
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { z } from 'zod';

export const DEFAULT_COMMISSION_RATE_BPS = 500; // 5.00%
export const DEFAULT_BUSINESS_TIMEZONE = 'Africa/Lagos';

export const commissionConfigSchema = z.object({
  commissionRateBps: z
    .number()
    .int('Commission rate must be a whole number of basis points')
    .min(0, 'Commission rate cannot be negative')
    .max(10000, 'Commission rate cannot exceed 100%')
    .refine((v) => v % 25 === 0, {
      message: 'Commission rate must be in 0.25% (25 bps) steps',
    }),
  businessTimezone: z
    .string()
    .min(1)
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown IANA timezone'),
  settlementHourLocal: z.number().int().min(0).max(23),
  autoSettlementEnabled: z.boolean(),
  manualApprovalRequired: z.boolean(),
  minSettlementKobo: z.number().int().min(0).max(1_000_000_000),
  recipientBankCode: z.string().max(20).regex(/^[0-9]*$/, 'Bank code must be numeric').nullable(),
  recipientBankName: z.string().max(100).nullable(),
  recipientAccountNumber: z
    .string()
    .max(30)
    .regex(/^[0-9]*$/, 'Account number must be numeric')
    .nullable(),
  recipientAccountName: z.string().max(100).nullable(),
});

export type CommissionConfigInput = z.infer<typeof commissionConfigSchema>;

export type CommissionConfigRecord = {
  id: number;
  commissionRateBps: number;
  businessTimezone: string;
  settlementHourLocal: number;
  autoSettlementEnabled: boolean;
  manualApprovalRequired: boolean;
  minSettlementKobo: number;
  recipientBankCode: string | null;
  recipientBankName: string | null;
  recipientAccountNumber: string | null;
  recipientAccountName: string | null;
  updatedAt: Date;
};

/** Read (creating on first use) the singleton commission configuration. */
export async function getCommissionConfig(): Promise<CommissionConfigRecord> {
  const existing = await prisma.commissionConfig.findUnique({ where: { id: 1 } });
  if (existing) return existing as CommissionConfigRecord;

  return (await prisma.commissionConfig.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      commissionRateBps: DEFAULT_COMMISSION_RATE_BPS,
      businessTimezone: DEFAULT_BUSINESS_TIMEZONE,
      autoSettlementEnabled: false,
      manualApprovalRequired: true,
    },
  })) as CommissionConfigRecord;
}

/** True when the school recipient account is fully configured. */
export function hasSchoolRecipient(config: CommissionConfigRecord): boolean {
  return Boolean(config.recipientBankCode && config.recipientAccountNumber);
}

export type ConfigUpdateResult =
  | { success: true; config: CommissionConfigRecord }
  | { error: string };

/**
 * Update commission configuration. Caller must already be authorized as an
 * administrator (enforced by the server action / API route that calls this);
 * every change is recorded in the audit trail with before/after values.
 */
export async function updateCommissionConfig(
  input: CommissionConfigInput,
  actorUserId: string
): Promise<ConfigUpdateResult> {
  const parsed = commissionConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid configuration' };
  }

  const before = await getCommissionConfig();
  const data = parsed.data;

  // Never silently drop half of the recipient: either both are present or
  // both are cleared.
  const recipientIncomplete =
    Boolean(data.recipientBankCode) !== Boolean(data.recipientAccountNumber);
  if (recipientIncomplete) {
    return { error: 'Recipient bank code and account number must be set together.' };
  }

  const config = await prisma.commissionConfig.update({
    where: { id: 1 },
    data: {
      commissionRateBps: data.commissionRateBps,
      businessTimezone: data.businessTimezone,
      settlementHourLocal: data.settlementHourLocal,
      autoSettlementEnabled: data.autoSettlementEnabled,
      manualApprovalRequired: data.manualApprovalRequired,
      minSettlementKobo: data.minSettlementKobo,
      recipientBankCode: data.recipientBankCode,
      recipientBankName: data.recipientBankName,
      recipientAccountNumber: data.recipientAccountNumber,
      recipientAccountName: data.recipientAccountName,
    },
  });

  await logAudit({
    userId: actorUserId,
    action: 'commission.config_updated',
    entity: 'CommissionConfig',
    entityId: '1',
    details: {
      before: {
        commissionRateBps: before.commissionRateBps,
        businessTimezone: before.businessTimezone,
        settlementHourLocal: before.settlementHourLocal,
        autoSettlementEnabled: before.autoSettlementEnabled,
        manualApprovalRequired: before.manualApprovalRequired,
        minSettlementKobo: before.minSettlementKobo,
        recipientConfigured: hasSchoolRecipient(before),
      },
      after: {
        commissionRateBps: config.commissionRateBps,
        businessTimezone: config.businessTimezone,
        settlementHourLocal: config.settlementHourLocal,
        autoSettlementEnabled: config.autoSettlementEnabled,
        manualApprovalRequired: config.manualApprovalRequired,
        minSettlementKobo: config.minSettlementKobo,
        recipientConfigured: hasSchoolRecipient(config),
      },
      // Never log full bank details.
      recipientAccountChanged:
        before.recipientAccountNumber !== config.recipientAccountNumber,
    },
  });

  return { success: true, config: config as CommissionConfigRecord };
}
