import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCommissionConfig } from '@/lib/commission/config';
import {
  getDriverDaySummary,
  getDriverEarningRows,
} from '@/lib/commission/daily';
import { businessDayKey, dayKeyToIso } from '@/lib/commission/time';
import { formatKobo, rateBpsToPercent } from '@/lib/commission/money';
import PayoutPanel from './PayoutPanel';

export default async function DriverEarningsPage() {
  const session = await auth();
  const userId = (session?.user as { id: string })?.id;

  const driver = await prisma.driver.findUnique({ where: { userId } });

  const config = await getCommissionConfig();
  const todayKey = businessDayKey(new Date(), config.businessTimezone);

  const [today, rows, totals, payoutAccount, unpaid] = await Promise.all([
    driver
      ? getDriverDaySummary(driver.id, todayKey)
      : Promise.resolve(null),
    driver ? getDriverEarningRows(driver.id) : Promise.resolve([]),
    driver
      ? prisma.driverEarning.aggregate({
          where: { driverId: driver.id, status: 'ACCRUED' },
          _sum: {
            eligibleAmountKobo: true,
            commissionAmountKobo: true,
            netAmountKobo: true,
          },
          _count: { id: true },
        })
      : Promise.resolve(null),
    driver
      ? prisma.driverPaymentAccount.findUnique({ where: { driverId: driver.id } })
      : Promise.resolve(null),
    driver
      ? prisma.driverEarning.aggregate({
          where: { driverId: driver.id, status: 'ACCRUED', payoutStatus: 'UNPAID' },
          _sum: { netAmountKobo: true },
          _count: { id: true },
        })
      : Promise.resolve(null),
  ]);

  const unpaidKobo = unpaid?._sum.netAmountKobo ?? 0;
  const unpaidRides = unpaid?._count.id ?? 0;

  // Week-to-date (business timezone, Sunday-start week).
  const weekStartKey = new Date(
    todayKey.getTime() - todayKey.getUTCDay() * 86_400_000
  );
  const weekRows = rows.filter((r) => r.dayIso >= dayKeyToIso(weekStartKey));
  const weekNetKobo = weekRows.reduce((sum, r) => sum + r.netAmountKobo, 0);

  const allTimeNetKobo = totals?._sum.netAmountKobo ?? 0;
  const allTimeCount = totals?._count.id ?? 0;
  const todayNetKobo = today?.netKobo ?? 0;
  const todayGrossKobo = today?.eligibleGrossKobo ?? 0;
  const todayCommissionKobo = today?.commissionKobo ?? 0;
  const todayRides = today?.eligibleRideCount ?? 0;
  const rateLabel = rateBpsToPercent(today?.commissionRateBps ?? config.commissionRateBps);

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-[var(--foreground)] mb-1">Earnings</h1>
      <p className="text-sm text-[var(--muted)] mb-6">
        Your ride earnings, school commission and payout status
      </p>

      {/* Commission breakdown for today */}
      <div className="cc-card rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wide">
            Today&apos;s Commission ({dayKeyToIso(todayKey)})
          </p>
          <p className="text-xs text-[var(--muted)]">School rate {rateLabel}</p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs text-[var(--muted)]">Eligible earnings</p>
            <p className="text-lg font-bold text-[var(--foreground)] mt-1">
              {formatKobo(todayGrossKobo)}
            </p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{todayRides} rides</p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted)]">School commission</p>
            <p className="text-lg font-bold text-[var(--foreground)] mt-1">
              {formatKobo(todayCommissionKobo)}
            </p>
            <p className="text-xs text-[var(--muted)] mt-0.5">accrued at {rateLabel}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted)]">Your net</p>
            <p className="text-lg font-bold text-[var(--foreground)] mt-1">
              {formatKobo(todayNetKobo)}
            </p>
            <p className="text-xs text-[var(--muted)] mt-0.5">after commission</p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="cc-card rounded-2xl p-5 text-center">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wide">Today</p>
          <p className="text-xl font-bold text-[var(--foreground)] mt-1">
            {formatKobo(todayNetKobo)}
          </p>
          <p className="text-xs text-[var(--muted)] mt-0.5">{todayRides} rides</p>
        </div>
        <div className="cc-card rounded-2xl p-5 text-center">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wide">This Week</p>
          <p className="text-xl font-bold text-[var(--foreground)] mt-1">
            {formatKobo(weekNetKobo)}
          </p>
          <p className="text-xs text-[var(--muted)] mt-0.5">{weekRows.length} rides</p>
        </div>
        <div className="cc-card rounded-2xl p-5 text-center">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wide">All Time</p>
          <p className="text-xl font-bold text-[var(--foreground)] mt-1">
            {formatKobo(allTimeNetKobo)}
          </p>
          <p className="text-xs text-[var(--muted)] mt-0.5">{allTimeCount} rides</p>
        </div>
      </div>

      {/* Payout: bank details + request payment */}
      <PayoutPanel
        bank={
          payoutAccount?.accountNumber
            ? {
                bankName: payoutAccount.bankName,
                accountNumber: payoutAccount.accountNumber,
                accountName: payoutAccount.accountName,
                verified: payoutAccount.verificationStatus === 'VERIFIED',
              }
            : null
        }
        unpaidKobo={unpaidKobo}
        unpaidRides={unpaidRides}
        payoutsEnabled={Boolean(process.env.FLUTTERWAVE_TRANSFERS_ENABLED)}
      />

      {/* Earnings History */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--foreground)] mb-2 uppercase tracking-wide">
          Earnings History
        </h2>
        {rows.length > 0 ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                  <th className="text-left px-4 py-2 font-medium text-xs">Date</th>
                  <th className="text-left px-4 py-2 font-medium text-xs">Route</th>
                  <th className="text-right px-4 py-2 font-medium text-xs hidden sm:table-cell">
                    Gross
                  </th>
                  <th className="text-right px-4 py-2 font-medium text-xs">
                    Commission ({rateLabel})
                  </th>
                  <th className="text-right px-4 py-2 font-medium text-xs">Net</th>
                  <th className="text-right px-4 py-2 font-medium text-xs hidden sm:table-cell">
                    Payout
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.earningId} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="px-4 py-2 text-[var(--muted)]">{row.dayIso}</td>
                    <td className="px-4 py-2 text-[var(--foreground)]">
                      {row.pickupName ?? '—'} → {row.dropoffName ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-[var(--muted)] hidden sm:table-cell">
                      {formatKobo(row.eligibleAmountKobo)}
                    </td>
                    <td className="px-4 py-2 text-right text-[var(--muted)]">
                      −{formatKobo(row.commissionAmountKobo)}
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-[var(--foreground)]">
                      {formatKobo(row.netAmountKobo)}
                    </td>
                    <td className="px-4 py-2 text-right hidden sm:table-cell">
                      {row.payoutStatus === 'PAID' ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-600">
                          Paid
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600">
                          Pending
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="cc-card rounded-2xl p-6 text-center">
            <p className="text-sm text-[var(--muted)]">No earnings yet.</p>
          </div>
        )}
        <p className="text-xs text-[var(--muted)] mt-3">
          Commission is accrued when a paid ride is completed. &quot;Pending&quot; payout means
          the money has not been transferred to you yet — amounts shown are earnings records,
          not confirmed bank payouts.
        </p>
      </div>
    </div>
  );
}
