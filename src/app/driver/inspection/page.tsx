'use client';

import { useState, useTransition } from 'react';
import { submitInspection } from '@/lib/actions/driver';
import { useRouter } from 'next/navigation';

const CHECKLIST_ITEMS = [
  { key: 'brakes', label: 'Brakes', desc: 'Brakes are functioning properly' },
  { key: 'tires', label: 'Tires', desc: 'Tires are in good condition' },
  { key: 'lights', label: 'Lights', desc: 'All lights are working' },
  { key: 'interiorClean', label: 'Interior Clean', desc: 'Interior is clean and tidy' },
  { key: 'noTrash', label: 'No Trash', desc: 'No trash in the vehicle' },
  { key: 'fireExtinguisher', label: 'Fire Extinguisher', desc: 'Fire extinguisher is present and functional' },
  { key: 'firstAidKit', label: 'First Aid Kit', desc: 'First aid kit is available' },
  { key: 'fuelBattery', label: 'Fuel/Battery Above 50%', desc: 'Fuel or battery level above 50%' },
] as const;

type ChecklistKey = typeof CHECKLIST_ITEMS[number]['key'];

export default function InspectionForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [checks, setChecks] = useState<Record<ChecklistKey, boolean>>({
    brakes: false,
    tires: false,
    lights: false,
    interiorClean: false,
    noTrash: false,
    fireExtinguisher: false,
    firstAidKit: false,
    fuelBattery: false,
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const allChecked = Object.values(checks).every(Boolean);
  const checkedCount = Object.values(checks).filter(Boolean).length;

  const toggle = (key: ChecklistKey) => {
    setChecks((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmit = () => {
    if (!allChecked) {
      setError('You must complete all items before submitting.');
      return;
    }
    setError('');

    startTransition(async () => {
      const result = await submitInspection(checks);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess(true);
    });
  };

  if (success) {
    return (
      <div className="p-4 lg:p-6 max-w-lg mx-auto">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 text-center">
          <div className="text-4xl mb-3">✓</div>
          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-1">Inspection Complete</h2>
          <p className="text-sm text-[var(--muted)] mb-4">Your vehicle has passed inspection. You can now go online.</p>
          <button
            onClick={() => router.push('/driver/dashboard')}
            className="px-4 py-2 bg-[var(--primary)] text-[var(--primary-text)] rounded-md text-sm font-medium hover:bg-[var(--primary-hover)] transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-lg mx-auto">
      <h1 className="text-xl font-bold text-[var(--foreground)] mb-1">Vehicle Inspection</h1>
      <p className="text-sm text-[var(--muted)] mb-6">Complete all items before going online</p>

      {/* Progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-[var(--muted)]">{checkedCount} of {CHECKLIST_ITEMS.length} items</span>
          <span className={`font-medium ${allChecked ? 'text-green-600' : 'text-[var(--muted)]'}`}>
            {allChecked ? 'All clear' : `${Math.round((checkedCount / CHECKLIST_ITEMS.length) * 100)}%`}
          </span>
        </div>
        <div className="h-2 bg-[var(--border)] rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 rounded-full ${allChecked ? 'bg-green-500' : 'bg-[var(--primary)]'}`}
            style={{ width: `${(checkedCount / CHECKLIST_ITEMS.length) * 100}%` }}
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="space-y-2 mb-6">
        {CHECKLIST_ITEMS.map((item) => (
          <button
            key={item.key}
            onClick={() => toggle(item.key)}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
              checks[item.key]
                ? 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
                : 'border-[var(--border)] hover:border-[var(--muted)]'
            }`}
          >
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
              checks[item.key]
                ? 'bg-green-500 border-green-500 text-white'
                : 'border-[var(--border)]'
            }`}>
              {checks[item.key] && <span className="text-xs">✓</span>}
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">{item.label}</p>
              <p className="text-xs text-[var(--muted)]">{item.desc}</p>
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={handleSubmit}
        disabled={!allChecked || pending}
        className="w-full py-3 bg-[var(--primary)] text-[var(--primary-text)] rounded-md font-medium text-sm hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors"
      >
        {pending ? 'Submitting...' : 'Submit Inspection'}
      </button>
    </div>
  );
}
