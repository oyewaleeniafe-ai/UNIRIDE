'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { startTrip, completeTrip, cancelTrip } from '@/lib/actions/trips';

type RideAction = 'start' | 'complete' | 'cancel';

const SUCCESS_TEXT: Record<RideAction, string> = {
  start: 'Ride started.',
  complete: 'Ride completed.',
  cancel: 'Ride cancelled.',
};

/**
 * Action buttons for a driver's active ride (Start Ride / Complete Ride / Cancel).
 * - Disables all buttons and shows "Processing…" while a request is in flight
 *   (prevents double submission).
 * - Surfaces the server action's error/success result inline — previously the
 *   result was discarded, so server rejections looked like the button did nothing.
 * - Refreshes the page data after a successful action.
 */
export default function RideActions({
  tripId,
  status,
  paymentConfirmed,
}: {
  tripId: string;
  status: 'ACCEPTED' | 'IN_PROGRESS';
  paymentConfirmed?: boolean;
}) {
  const [busy, setBusy] = useState<RideAction | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const router = useRouter();

  async function run(action: RideAction) {
    if (busy) return;
    setMsg(null);
    setBusy(action);
    try {
      const res =
        action === 'start'
          ? await startTrip(tripId)
          : action === 'complete'
            ? await completeTrip(tripId)
            : await cancelTrip(tripId);

      if (res && 'error' in res && res.error) {
        setMsg({ kind: 'error', text: res.error });
      } else {
        setMsg({ kind: 'success', text: SUCCESS_TEXT[action] });
        router.refresh();
      }
    } catch {
      setMsg({ kind: 'error', text: 'Something went wrong. Please try again.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        {status === 'ACCEPTED' && (
          <button
            type="button"
            onClick={() => run('start')}
            disabled={busy !== null}
            className="px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {busy === 'start' ? 'Processing…' : 'Start Ride'}
          </button>
        )}
        {status === 'IN_PROGRESS' && (
          <button
            type="button"
            onClick={() => run('complete')}
            disabled={busy !== null}
            className="px-4 py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-xl text-sm font-semibold hover:bg-[var(--primary-hover)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {busy === 'complete' ? 'Processing…' : 'Complete Ride'}
          </button>
        )}
        <button
          type="button"
          onClick={() => run('cancel')}
          disabled={busy !== null}
          className="px-4 py-2.5 border border-[var(--border-color)] text-[var(--danger)] rounded-xl text-sm font-semibold hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {busy === 'cancel' ? 'Processing…' : 'Cancel'}
        </button>
      </div>

      {status === 'IN_PROGRESS' && paymentConfirmed === false && (
        <p className="text-xs text-[var(--muted)] mt-2">
          ⏳ Waiting for payment confirmation — the ride can only be completed once the student&apos;s payment succeeds.
        </p>
      )}

      {msg && (
        <p
          role="status"
          className={`text-xs mt-2 font-medium ${
            msg.kind === 'error' ? 'text-[var(--danger)]' : 'text-green-600 dark:text-green-400'
          }`}
        >
          {msg.kind === 'error' ? '✕ ' : '✓ '}
          {msg.text}
        </p>
      )}
    </div>
  );
}
