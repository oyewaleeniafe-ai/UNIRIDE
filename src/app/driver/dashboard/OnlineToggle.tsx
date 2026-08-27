'use client';

import { useState, useTransition } from 'react';
import { toggleDriverOnline } from '@/lib/actions/driver';

export default function OnlineToggle({
  initialOnline,
  isInspectionComplete,
}: {
  initialOnline: boolean;
  isInspectionComplete: boolean;
}) {
  const [isOnline, setIsOnline] = useState(initialOnline);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const handleToggle = () => {
    const newStatus = !isOnline;
    setError('');

    startTransition(async () => {
      const result = await toggleDriverOnline(newStatus);
      if (result.error) {
        setError(result.error);
        return;
      }
      setIsOnline(newStatus);
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleToggle}
        disabled={pending}
        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
          isOnline
            ? 'bg-green-600 text-white hover:bg-green-700'
            : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface-hover)]'
        } disabled:opacity-50`}
      >
        {pending ? '...' : isOnline ? '● Online' : '○ Offline'}
      </button>
      {error && (
        <p className="text-xs text-[var(--danger)]">{error}</p>
      )}
    </div>
  );
}
