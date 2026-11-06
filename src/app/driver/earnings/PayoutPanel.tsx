'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { requestDriverPayout, saveDriverBankAccount } from '@/lib/actions/driver';
import { NIGERIAN_BANKS } from '@/lib/payments/banks';
import { maskAccountNumber } from '@/lib/payments/types';
import { formatKobo } from '@/lib/commission/money';

export type SavedBankAccount = {
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  verified?: boolean;
};

export default function PayoutPanel({
  bank,
  unpaidKobo,
  unpaidRides,
  payoutsEnabled,
}: {
  bank: SavedBankAccount | null;
  unpaidKobo: number;
  unpaidRides: number;
  payoutsEnabled: boolean;
}) {
  const [savedBank, setSavedBank] = useState<SavedBankAccount | null>(bank);
  const [editing, setEditing] = useState(!bank);
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savingBank, startSave] = useTransition();
  const [requesting, startRequest] = useTransition();

  const hasBank = Boolean(savedBank?.accountNumber && savedBank?.bankName);
  const canRequest = hasBank && unpaidKobo > 0 && payoutsEnabled;

  const handleSaveBank = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');

    startSave(async () => {
      const result = await saveDriverBankAccount({ bankCode, accountNumber, accountName });
      if ('error' in result && result.error) {
        setError(result.error);
        return;
      }
      if ('bank' in result && result.bank) {
        setSavedBank({
          bankName: result.bank.bankName,
          accountNumber: result.bank.accountNumber,
          accountName: result.bank.accountName,
          verified: result.bank.verified,
        });
        setEditing(false);
        setAccountNumber('');
        setAccountName('');
        setBankCode('');
        setNotice(
          result.bank.verified
            ? `Bank details saved and verified — account name: ${result.bank.accountName}.`
            : 'Bank details saved. They will be verified before your first payout.'
        );
      }
    });
  };

  const handleRequestPayout = () => {
    setError('');
    setNotice('');

    startRequest(async () => {
      const result = await requestDriverPayout();
      if ('error' in result && result.error) {
        setError(result.error);
        return;
      }
      if ('success' in result && result.success) {
        setNotice(
          result.paidKobo > 0
            ? `Payment sent: ${formatKobo(result.paidKobo)} is on its way to your bank account.`
            : `Payment started for ${result.paidCount} ${result.paidCount === 1 ? 'ride' : 'rides'}.`
        );
      }
    });
  };

  return (
    <div className="cc-card rounded-2xl p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-xs text-[var(--muted)] uppercase tracking-wide">Get paid</p>
          <p className="text-xl font-bold text-[var(--foreground)] mt-1">
            {formatKobo(unpaidKobo)}
          </p>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {unpaidRides} unpaid {unpaidRides === 1 ? 'ride' : 'rides'}
          </p>
        </div>
        {hasBank && !editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setNotice('');
              setError('');
            }}
            className="text-xs font-medium text-[var(--primary)] hover:underline"
          >
            Change bank details
          </button>
        )}
      </div>

      {hasBank && !editing ? (
        <div className="rounded-xl border border-[var(--border)] p-3 mb-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-[var(--foreground)]">{savedBank?.accountName}</p>
            {savedBank?.verified ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-600 whitespace-nowrap">
                Verified
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 whitespace-nowrap">
                Not verified
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {savedBank?.bankName} · {maskAccountNumber(savedBank?.accountNumber ?? undefined)}
          </p>
        </div>
      ) : (
        <form onSubmit={handleSaveBank} className="space-y-3 mb-3">
          <div>
            <label htmlFor="payout-bank" className="block text-xs text-[var(--muted)] mb-1">
              Bank
            </label>
            <select
              id="payout-bank"
              value={bankCode}
              onChange={(event) => setBankCode(event.target.value)}
              className="cc-input"
              required
            >
              <option value="">Select your bank</option>
              {NIGERIAN_BANKS.map((bankOption) => (
                <option key={bankOption.code} value={bankOption.code}>
                  {bankOption.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="payout-account-number" className="block text-xs text-[var(--muted)] mb-1">
              Account number
            </label>
            <input
              id="payout-account-number"
              value={accountNumber}
              onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              maxLength={10}
              placeholder="0123456789"
              className="cc-input"
              required
            />
          </div>
          <div>
            <label htmlFor="payout-account-name" className="block text-xs text-[var(--muted)] mb-1">
              Account name
            </label>
            <input
              id="payout-account-name"
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              placeholder="As it appears on your bank account"
              className="cc-input"
              required
            />
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={savingBank} className="cc-btn-primary disabled:opacity-50">
              {savingBank ? 'Saving…' : 'Save bank details'}
            </button>
            {bank && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError('');
                }}
                className="text-sm text-[var(--muted)] hover:underline"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      <button
        type="button"
        onClick={handleRequestPayout}
        disabled={!canRequest || requesting}
        className="cc-btn-primary w-full disabled:opacity-50"
      >
        {requesting
          ? 'Requesting…'
          : unpaidKobo > 0
            ? `Request ${formatKobo(unpaidKobo)} payment`
            : 'No balance to request'}
      </button>

      {!payoutsEnabled && (
        <p className="text-xs text-[var(--muted)] mt-2">
          Bank transfers are being activated. You can save your details now and request payment
          once transfers are live.
        </p>
      )}
      {error && <p className="text-xs text-[var(--danger)] mt-2">{error}</p>}
      {notice && <p className="text-xs text-green-600 mt-2">{notice}</p>}
    </div>
  );
}
