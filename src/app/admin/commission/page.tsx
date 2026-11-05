import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getSessionUser, isAdmin } from '@/lib/commission/authz';
import { getCommissionConfig } from '@/lib/commission/config';
import {
  getCommissionByDay,
  getCommissionByDriver,
  getSchoolDaySummary,
  getSchoolGlobalSummary,
} from '@/lib/commission/daily';
import { businessDayKey, dayKeyToIso } from '@/lib/commission/time';
import { CommissionAdminClient } from './CommissionAdminClient';

export const dynamic = 'force-dynamic';

/**
 * School commission management & reconciliation dashboard.
 * ADMIN only — enforced server-side before any data is loaded.
 */
export default async function AdminCommissionPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!isAdmin(user)) redirect('/driver/dashboard');

  const config = await getCommissionConfig();
  const todayKey = businessDayKey(new Date(), config.businessTimezone);

  const [global, day, byDay, byDriver, settlements, ledger] = await Promise.all([
    getSchoolGlobalSummary(),
    getSchoolDaySummary(todayKey),
    getCommissionByDay(),
    getCommissionByDriver(),
    prisma.commissionSettlement.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    prisma.commissionLedgerEntry.findMany({
      include: {
        driver: { select: { driverId: true, user: { select: { name: true } } } },
        earning: { select: { paymentReference: true, tripId: true } },
        settlement: { select: { reference: true, transferStatus: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  return (
    <CommissionAdminClient
      initial={{
        dayIso: dayKeyToIso(todayKey),
        config: {
          commissionRateBps: config.commissionRateBps,
          businessTimezone: config.businessTimezone,
          settlementHourLocal: config.settlementHourLocal,
          autoSettlementEnabled: config.autoSettlementEnabled,
          manualApprovalRequired: config.manualApprovalRequired,
          minSettlementKobo: config.minSettlementKobo,
          recipientBankCode: config.recipientBankCode,
          recipientBankName: config.recipientBankName,
          recipientAccountNumber: config.recipientAccountNumber,
          recipientAccountName: config.recipientAccountName,
        },
        day,
        global,
        byDay,
        byDriver,
        settlements: settlements.map((s) => ({
          id: s.id,
          reference: s.reference,
          periodDate: dayKeyToIso(s.periodDate),
          totalAmountKobo: s.totalAmountKobo,
          entryCount: s.entryCount,
          recipientLabel: s.recipientLabel,
          providerReference: s.providerReference,
          transferStatus: s.transferStatus,
          reconciliationStatus: s.reconciliationStatus,
          failureReason: s.failureReason,
          initiatedAt: s.initiatedAt?.toISOString() ?? null,
          confirmedAt: s.confirmedAt?.toISOString() ?? null,
          createdAt: s.createdAt.toISOString(),
        })),
        ledger: ledger.map((e) => ({
          id: e.id,
          driverName: e.driver?.user?.name ?? 'Unknown',
          driverCode: e.driver?.driverId ?? '',
          tripId: e.earning?.tripId ?? null,
          paymentReference: e.earning?.paymentReference ?? null,
          amountKobo: e.amountKobo,
          commissionRateBps: e.commissionRateBps,
          periodDate: dayKeyToIso(e.periodDate),
          entryType: e.entryType,
          status: e.status,
          settlementReference: e.settlement?.reference ?? null,
          createdAt: e.createdAt.toISOString(),
        })),
      }}
    />
  );
}
