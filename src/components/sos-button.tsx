'use client';

import { useState, useTransition } from 'react';
import { sendSOS } from '@/lib/actions/misc';
import { Siren } from 'lucide-react';

export default function SOSButton() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSend = () => {
    setError('');
    startTransition(async () => {
      let lat: number | undefined;
      let lng: number | undefined;

      if ('geolocation' in navigator) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
          });
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        } catch {
          // Location unavailable
        }
      }

      const result = await sendSOS({ latitude: lat, longitude: lng });
      if ('error' in result) {
        setError(String(result.error));
        return;
      }
      setSent(true);
      setShowConfirm(false);
    });
  };

  if (sent) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-center">
        <p className="text-sm font-medium text-red-700 dark:text-red-400">Emergency alert has been recorded.</p>
        <p className="text-xs text-red-600 dark:text-red-500 mt-1">If you are in immediate danger, please call campus security directly.</p>
        <button onClick={() => setSent(false)} className="mt-2 text-xs text-[var(--primary)] hover:underline">Dismiss</button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
        className="cc-card cc-card-hover rounded-2xl p-4 flex flex-col gap-2.5 w-full text-left"
      >
        <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/25 text-[var(--danger)]">
          <Siren className="w-5 h-5" />
        </span>
        <div>
          <div className="text-sm font-semibold text-[var(--foreground)]">SOS</div>
          <div className="text-xs text-[var(--muted)] mt-0.5">Emergency alert</div>
        </div>
      </button>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-[var(--surface)] border border-[var(--border-color)] rounded-2xl p-6 max-w-sm w-full shadow-[var(--shadow-xl)]">
            <h3 className="text-lg font-semibold text-[var(--foreground)] mb-2">Emergency Alert</h3>
            <p className="text-sm text-[var(--muted)] mb-4">
              Are you sure you want to send an emergency alert? This will record your current location and active ride information.
            </p>

            {error && (
              <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-xs text-red-700 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setShowConfirm(false); setError(''); }}
                disabled={pending}
                className="flex-1 py-2 border border-[var(--border)] rounded-md text-sm font-medium text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={pending}
                className="flex-1 py-2 bg-[var(--danger)] text-white rounded-md text-sm font-medium hover:bg-[var(--danger-hover)] disabled:opacity-50 transition-colors"
              >
                {pending ? 'Sending...' : 'SEND SOS'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
