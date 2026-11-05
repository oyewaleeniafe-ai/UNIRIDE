'use client';

/**
 * School commission administration client — metrics, commission by day/driver,
 * ledger, settlement history with initiate/verify/cancel, and configuration.
 *
 * Every mutation goes through server actions that enforce ADMIN server-side;
 * this component only renders state and reports the server's responses.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  cancelCommissionSettlement,
  initiateCommissionTransfer,
  prepareCommissionSettlement,
  reverseTripCommission,
  runCommissionSettlementCycle,
  runEarningsBackfill,
  saveCommissionSettings,
  verifyCommissionSettlement,
} from '@/lib/actions/commission';
import { formatKobo, rateBpsToPercent } from '@/lib/commission/money';

type Config = {
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
};

type Initial = {
  dayIso: string;
  config: Config;
  day: {
    eligibleRideCount: number;
    driverCount: number;
    totalEligibleGrossKobo: number;
    commissionAccruedKobo: number;
    commissionNetOfReversalsKobo: number;
    outstandingKobo: number;
    reservedKobo: number;
    settledKobo: number;
    pendingSettlementCount: number;
    failedSettlementCount: number;
  };
  global: {
    totalAccruedKobo: number;
    totalOutstandingKobo: number;
    totalReservedKobo: number;
    totalSettledKobo: number;
    totalEligibleGrossKobo: number;
    eligibleRideCount: number;
    activeDriverCount: number;
    settlementCounts: Record<string, number>;
  };
  byDay: { dayIso: string; eligibleRideCount: number; grossKobo: number; commissionKobo: number }[];
  byDriver: {
    driverId: string;
    driverName: string;
    driverCode: string;
    eligibleRideCount: number;
    grossKobo: number;
    commissionKobo: number;
  }[];
  settlements: {
    id: string;
    reference: string;
    periodDate: string;
    totalAmountKobo: number;
    entryCount: number;
    recipientLabel: string | null;
    providerReference: string | null;
    transferStatus: string;
    reconciliationStatus: string;
    failureReason: string | null;
    initiatedAt: string | null;
    confirmedAt: string | null;
    createdAt: string;
  }[];
  ledger: {
    id: string;
    driverName: string;
    driverCode: string;
    tripId: string | null;
    paymentReference: string | null;
    amountKobo: number;
    commissionRateBps: number;
    periodDate: string;
    entryType: string;
    status: string;
    settlementReference: string | null;
    createdAt: string;
  }[];
};

const STATUS_STYLES: Record<string, string> = {
  OUTSTANDING: 'bg-amber-500/15 text-amber-600',
  RESERVED: 'bg-blue-500/15 text-blue-600',
  SETTLED: 'bg-green-500/15 text-green-600',
  REVERSED: 'bg-red-500/15 text-red-600',
  PREPARED: 'bg-amber-500/15 text-amber-600',
  TRANSFERRING: 'bg-blue-500/15 text-blue-600',
  SUCCESSFUL: 'bg-green-500/15 text-green-600',
  FAILED: 'bg-red-500/15 text-red-600',
  BLOCKED: 'bg-orange-500/15 text-orange-600',
  CANCELLED: 'bg-gray-500/15 text-gray-500',
  ACCRUAL: 'bg-slate-500/15 text-slate-600',
  ADJUSTMENT: 'bg-purple-500/15 text-purple-600',
  REVERSAL: 'bg-red-500/15 text-red-600',
};

function badge(status: string): string {
  return `text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[status] ?? 'bg-gray-500/15 text-gray-500'}`;
}

type Notice = { kind: 'ok' | 'error'; text: string } | null;

export function CommissionAdminClient({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);
  const [ledgerStatusFilter, setLedgerStatusFilter] = useState<string>('ALL');

  const [config, setConfig] = useState<Config>(initial.config);
  const [ratePercent, setRatePercent] = useState(String(initial.config.commissionRateBps / 100));
  const [minNaira, setMinNaira] = useState(String(initial.config.minSettlementKobo / 100));

  const run = (fn: () => Promise<{ error?: string } & Record<string, unknown>>) => {
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (result && typeof result === 'object' && 'error' in result && result.error) {
          setNotice({ kind: 'error', text: String(result.error) });
        } else {
          const note =
            (result?.reason as string | undefined) ??
            (result?.note as string | undefined) ??
            'Done.';
          setNotice({ kind: 'ok', text: note });
          router.refresh();
        }
      } catch (e) {
        setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Request failed.' });
      }
    });
  };

  const saveConfig = () => {
    const bps = Math.round(Number(ratePercent) * 100);
    const minKobo = Math.round(Number(minNaira) * 100);
    if (!Number.isFinite(bps) || !Number.isFinite(minKobo)) {
      setNotice({ kind: 'error', text: 'Invalid number in settings form.' });
      return;
    }
    run(async () =>
      saveCommissionSettings({
        ...config,
        commissionRateBps: bps,
        minSettlementKobo: minKobo,
      })
    );
  };

  const filteredLedger =
    ledgerStatusFilter === 'ALL'
      ? initial.ledger
      : initial.ledger.filter((e) => e.status === ledgerStatusFilter);

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h1 className="text-xl font-bold text-[var(--foreground)]">School Commission</h1>
        <div className="flex gap-2">
          <button
            onClick={() => run(() => runEarningsBackfill())}
            disabled={pending}
            className="text-xs px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface)] disabled:opacity-50"
          >
            Backfill earnings
          </button>
          <button
            onClick={() => run(() => runCommissionSettlementCycle())}
            disabled={pending}
            className="text-xs px-3 py-2 rounded-lg bg-[var(--foreground)] text-[var(--background)] disabled:opacity-50"
          >
            {pending ? 'Working…' : 'Run settlement cycle'}
          </button>
        </div>
      </div>
      <p className="text-sm text-[var(--muted)] mb-5">
        Day {initial.dayIso} · rate {rateBpsToPercent(initial.config.commissionRateBps)} ·{' '}
        {initial.config.businessTimezone} · automatic transfers{' '}
        {initial.config.autoSettlementEnabled ? 'enabled' : 'disabled'}
      </p>

      {notice && (
        <div
          className={`mb-4 text-sm rounded-lg px-4 py-3 border ${
            notice.kind === 'ok'
              ? 'bg-green-500/10 border-green-500/30 text-green-700'
              : 'bg-red-500/10 border-red-500/30 text-red-700'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* ── Metrics ─────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Eligible earnings today', value: formatKobo(initial.day.totalEligibleGrossKobo), sub: `${initial.day.eligibleRideCount} rides` },
          { label: 'Commission accrued today', value: formatKobo(initial.day.commissionAccruedKobo), sub: `${initial.day.driverCount} drivers` },
          { label: 'Outstanding (owed)', value: formatKobo(initial.global.totalOutstandingKobo), sub: 'awaiting settlement' },
          { label: 'Reserved (in settlement)', value: formatKobo(initial.global.totalReservedKobo), sub: `${initial.day.pendingSettlementCount} open settlements` },
          { label: 'Settled (transferred)', value: formatKobo(initial.global.totalSettledKobo), sub: 'confirmed by Flutterwave' },
          { label: 'All-time commission', value: formatKobo(initial.global.totalAccruedKobo), sub: `of ${formatKobo(initial.global.totalEligibleGrossKobo)} earnings` },
          { label: 'Eligible rides (all time)', value: String(initial.global.eligibleRideCount), sub: `${initial.global.activeDriverCount} drivers` },
          { label: 'Failed settlements', value: String(initial.global.settlementCounts.FAILED ?? 0), sub: `${initial.day.failedSettlementCount} today` },
        ].map((card) => (
          <div key={card.label} className="cc-card rounded-2xl p-4">
            <p className="text-xs text-[var(--muted)] uppercase tracking-wide">{card.label}</p>
            <p className="text-lg font-bold text-[var(--foreground)] mt-1">{card.value}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Settlements ─────────────────────────── */}
      <h2 className="text-sm font-semibold text-[var(--foreground)] mb-2 uppercase tracking-wide">
        Settlements
      </h2>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--muted)]">
              <th className="text-left px-4 py-2 font-medium text-xs">Period</th>
              <th className="text-left px-4 py-2 font-medium text-xs">Reference</th>
              <th className="text-right px-4 py-2 font-medium text-xs">Amount</th>
              <th className="text-left px-4 py-2 font-medium text-xs">Destination</th>
              <th className="text-left px-4 py-2 font-medium text-xs">Transfer ref</th>
              <th className="text-left px-4 py-2 font-medium text-xs">Status</th>
              <th className="text-left px-4 py-2 font-medium text-xs hidden lg:table-cell">Recon</th>
              <th className="text-right px-4 py-2 font-medium text-xs">Actions</th>
            </tr>
          </thead>
          <tbody>
            {initial.settlements.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-[var(--muted)] text-sm">
                  No settlements yet. Run the settlement cycle to prepare one.
                </td>
              </tr>
            )}
            {initial.settlements.map((s) => (
              <tr key={s.id} className="border-b border-[var(--border)] last:border-b-0 align-top">
                <td className="px-4 py-2 text-[var(--muted)]">{s.periodDate}</td>
                <td className="px-4 py-2 text-[var(--foreground)] text-xs">{s.reference}</td>
                <td className="px-4 py-2 text-right font-medium text-[var(--foreground)]">
                  {formatKobo(s.totalAmountKobo)}
                </td>
                <td className="px-4 py-2 text-[var(--muted)] text-xs">{s.recipientLabel ?? 'Not configured'}</td>
                <td className="px-4 py-2 text-[var(--muted)] text-xs">{s.providerReference ?? '—'}</td>
                <td className="px-4 py-2">
                  <span className={badge(s.transferStatus)}>{s.transferStatus}</span>
                  {s.failureReason && (
                    <p className="text-xs text-red-600 mt-1 max-w-[16rem]">{s.failureReason}</p>
                  )}
                </td>
                <td className="px-4 py-2 hidden lg:table-cell">
                  <span className={badge(s.reconciliationStatus)}>{s.reconciliationStatus}</span>
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {s.transferStatus === 'PREPARED' && (
                    <span className="inline-flex gap-1">
                      <button
                        onClick={() => run(() => initiateCommissionTransfer(s.id))}
                        disabled={pending}
                        className="text-xs px-2 py-1 rounded bg-[var(--foreground)] text-[var(--background)] disabled:opacity-50"
                      >
                        Transfer
                      </button>
                      <button
                        onClick={() => {
                          const reason = window.prompt('Reason for cancelling this settlement?');
                          if (reason) run(() => cancelCommissionSettlement(s.id, reason));
                        }}
                        disabled={pending}
                        className="text-xs px-2 py-1 rounded border border-[var(--border)] disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </span>
                  )}
                  {s.transferStatus === 'TRANSFERRING' && (
                    <button
                      onClick={() => run(() => verifyCommissionSettlement(s.id))}
                      disabled={pending}
                      className="text-xs px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
                    >
                      Verify
                    </button>
                  )}
                  {s.transferStatus === 'FAILED' && (
                    <button
                      onClick={() => run(() => prepareCommissionSettlement(s.periodDate))}
                      disabled={pending}
                      className="text-xs px-2 py-1 rounded border border-[var(--border)] disabled:opacity-50"
                    >
                      Re-prepare
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Commission by driver / by day ───────── */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div>
          <h2 className="text-sm font-semibold text-[var(--foreground)] mb-2 uppercase tracking-wide">
            Commission by driver — {initial.dayIso}
          </h2>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                  <th className="text-left px-4 py-2 font-medium text-xs">Driver</th>
                  <th className="text-right px-4 py-2 font-medium text-xs">Rides</th>
                  <th className="text-right px-4 py-2 font-medium text-xs">Gross</th>
                  <th className="text-right px-4 py-2 font-medium text-xs">Commission</th>
                </tr>
              </thead>
              <tbody>
                {initial.byDriver.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-5 text-center text-[var(--muted)] text-sm">
                      No eligible rides today.
                    </td>
                  </tr>
                )}
                {initial.byDriver.map((d) => (
                  <tr key={d.driverId} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="px-4 py-2 text-[var(--foreground)]">
                      {d.driverName}{' '}
                      <span className="text-xs text-[var(--muted)]">{d.driverCode}</span>
                    </td>
                    <td className="px-4 py-2 text-right text-[var(--muted)]">{d.eligibleRideCount}</td>
                    <td className="px-4 py-2 text-right text-[var(--muted)]">{formatKobo(d.grossKobo)}</td>
                    <td className="px-4 py-2 text-right font-medium text-[var(--foreground)]">
                      {formatKobo(d.commissionKobo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-[var(--foreground)] mb-2 uppercase tracking-wide">
            Commission by day
          </h2>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg overflow-hidden max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                  <th className="text-left px-4 py-2 font-medium text-xs">Day</th>
                  <th className="text-right px-4 py-2 font-medium text-xs">Rides</th>
                  <th className="text-right px-4 py-2 font-medium text-xs">Gross</th>
                  <th className="text-right px-4 py-2 font-medium text-xs">Commission</th>
                </tr>
              </thead>
              <tbody>
                {initial.byDay.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-5 text-center text-[var(--muted)] text-sm">
                      No commission history yet.
                    </td>
                  </tr>
                )}
                {[...initial.byDay].reverse().map((d) => (
                  <tr key={d.dayIso} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="px-4 py-2 text-[var(--foreground)]">{d.dayIso}</td>
                    <td className="px-4 py-2 text-right text-[var(--muted)]">{d.eligibleRideCount}</td>
                    <td className="px-4 py-2 text-right text-[var(--muted)]">{formatKobo(d.grossKobo)}</td>
                    <td className="px-4 py-2 text-right font-medium text-[var(--foreground)]">
                      {formatKobo(d.commissionKobo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Ledger ──────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold text-[var(--foreground)] uppercase tracking-wide">
          Commission ledger
        </h2>
        <select
          value={ledgerStatusFilter}
          onChange={(e) => setLedgerStatusFilter(e.target.value)}
          className="text-xs px-2 py-1 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
        >
          {['ALL', 'OUTSTANDING', 'RESERVED', 'SETTLED', 'REVERSED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--muted)]">
              <th className="text-left px-4 py-2 font-medium text-xs">Day</th>
              <th className="text-left px-4 py-2 font-medium text-xs">Driver</th>
              <th className="text-left px-4 py-2 font-medium text-xs">Payment ref</th>
              <th className="text-right px-4 py-2 font-medium text-xs">Commission</th>
              <th className="text-left px-4 py-2 font-medium text-xs">Type</th>
              <th className="text-left px-4 py-2 font-medium text-xs">Status</th>
              <th className="text-left px-4 py-2 font-medium text-xs hidden lg:table-cell">Settlement</th>
              <th className="text-right px-4 py-2 font-medium text-xs">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredLedger.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-5 text-center text-[var(--muted)] text-sm">
                  No ledger entries.
                </td>
              </tr>
            )}
            {filteredLedger.map((e) => (
              <tr key={e.id} className="border-b border-[var(--border)] last:border-b-0">
                <td className="px-4 py-2 text-[var(--muted)]">{e.periodDate}</td>
                <td className="px-4 py-2 text-[var(--foreground)] text-xs">
                  {e.driverName} <span className="text-[var(--muted)]">{e.driverCode}</span>
                </td>
                <td className="px-4 py-2 text-[var(--muted)] text-xs">{e.paymentReference ?? '—'}</td>
                <td className="px-4 py-2 text-right font-medium text-[var(--foreground)]">
                  {formatKobo(e.amountKobo)}
                </td>
                <td className="px-4 py-2">
                  <span className={badge(e.entryType)}>{e.entryType}</span>
                </td>
                <td className="px-4 py-2">
                  <span className={badge(e.status)}>{e.status}</span>
                </td>
                <td className="px-4 py-2 text-xs text-[var(--muted)] hidden lg:table-cell">
                  {e.settlementReference ?? '—'}
                </td>
                <td className="px-4 py-2 text-right">
                  {e.entryType === 'ACCRUAL' && e.status === 'SETTLED' && e.tripId && (
                    <button
                      onClick={() => {
                        const reason = window.prompt(
                          'Reason for reversing this settled commission? (Recorded as an adjustment against future settlements.)'
                        );
                        if (reason) run(() => reverseTripCommission(e.tripId as string, reason));
                      }}
                      disabled={pending}
                      className="text-xs px-2 py-1 rounded border border-[var(--border)] text-[var(--muted)] disabled:opacity-50"
                    >
                      Adjust
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Configuration ───────────────────────── */}
      <h2 className="text-sm font-semibold text-[var(--foreground)] mb-2 uppercase tracking-wide">
        Settings
      </h2>
      <div className="cc-card rounded-2xl p-5 mb-8">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <label className="block text-xs text-[var(--muted)]">
            Commission rate (%)
            <input
              type="number"
              step="0.25"
              min="0"
              max="100"
              value={ratePercent}
              onChange={(e) => setRatePercent(e.target.value)}
              className="mt-1 w-full text-sm px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Business timezone
            <input
              type="text"
              value={config.businessTimezone}
              onChange={(e) => setConfig({ ...config, businessTimezone: e.target.value })}
              className="mt-1 w-full text-sm px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Settlement hour (local, 0–23)
            <input
              type="number"
              min="0"
              max="23"
              value={config.settlementHourLocal}
              onChange={(e) =>
                setConfig({ ...config, settlementHourLocal: Number(e.target.value) })
              }
              className="mt-1 w-full text-sm px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Minimum settlement (₦)
            <input
              type="number"
              min="0"
              step="1"
              value={minNaira}
              onChange={(e) => setMinNaira(e.target.value)}
              className="mt-1 w-full text-sm px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            School bank code
            <input
              type="text"
              inputMode="numeric"
              value={config.recipientBankCode ?? ''}
              onChange={(e) => setConfig({ ...config, recipientBankCode: e.target.value || null })}
              className="mt-1 w-full text-sm px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            School account number
            <input
              type="text"
              inputMode="numeric"
              value={config.recipientAccountNumber ?? ''}
              onChange={(e) =>
                setConfig({ ...config, recipientAccountNumber: e.target.value || null })
              }
              className="mt-1 w-full text-sm px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            School bank name
            <input
              type="text"
              value={config.recipientBankName ?? ''}
              onChange={(e) => setConfig({ ...config, recipientBankName: e.target.value || null })}
              className="mt-1 w-full text-sm px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
            />
          </label>
          <label className="block text-xs text-[var(--muted)]">
            School account name
            <input
              type="text"
              value={config.recipientAccountName ?? ''}
              onChange={(e) =>
                setConfig({ ...config, recipientAccountName: e.target.value || null })
              }
              className="mt-1 w-full text-sm px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
            />
          </label>
          <div className="flex flex-col gap-3 pt-4">
            <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={config.autoSettlementEnabled}
                onChange={(e) =>
                  setConfig({ ...config, autoSettlementEnabled: e.target.checked })
                }
              />
              Enable automatic settlement
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={config.manualApprovalRequired}
                onChange={(e) =>
                  setConfig({ ...config, manualApprovalRequired: e.target.checked })
                }
              />
              Require manual approval before transfer
            </label>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={saveConfig}
            disabled={pending}
            className="text-sm px-4 py-2 rounded-lg bg-[var(--foreground)] text-[var(--background)] disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save settings'}
          </button>
          <p className="text-xs text-[var(--muted)]">
            Changes are audit-logged. Automatic transfers stay off until you enable them AND
            FLUTTERWAVE_TRANSFERS_ENABLED is set in the deployment environment.
          </p>
        </div>
      </div>
    </div>
  );
}
