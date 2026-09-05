'use client';

import { useState, useEffect, useTransition, useCallback } from 'react';
import { getActiveTripStatus, cancelTrip } from '@/lib/actions/trips';
import SOSButton from '@/components/sos-button';

interface TripData {
  id: string;
  status: string;
  totalFare: number;
  passengerCount: number;
  rideType: string;
  createdAt: string | Date;
  pickupLocation: { name: string };
  dropoffLocation: { name: string };
  driver?: {
    user: { name: string; phone?: string | null };
    vehicle?: { make: string; model: string; color: string; licensePlate: string } | null;
    rating?: number | null;
  } | null;
}

interface ActiveRideTrackerProps {
  initialTrip: TripData;
}

const RIDE_STEPS = [
  { key: 'PENDING', label: 'Requested', icon: '📋', description: 'Waiting for a driver' },
  { key: 'ACCEPTED', label: 'Accepted', icon: '🚗', description: 'Driver is on the way' },
  { key: 'IN_PROGRESS', label: 'In Progress', icon: '🛣️', description: 'Ride is underway' },
  { key: 'COMPLETED', label: 'Completed', icon: '✅', description: 'Arrived at destination' },
] as const;

const STATUS_INDEX: Record<string, number> = {
  PENDING: 0,
  ACCEPTED: 1,
  IN_PROGRESS: 2,
  COMPLETED: 3,
};

const statusColors: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  ACCEPTED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  IN_PROGRESS: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
};

const POLL_INTERVAL = 10000; // 10 seconds
const GRACE_PERIOD_SECONDS = 30; // Must match server-side constant

export default function ActiveRideTracker({ initialTrip }: ActiveRideTrackerProps) {
  const [trip, setTrip] = useState<TripData>(initialTrip);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isPolling, startTransition] = useTransition();
  const [statusChanged, setStatusChanged] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [graceTimeLeft, setGraceTimeLeft] = useState(() => {
    const tripAge = Math.floor((Date.now() - new Date(initialTrip.createdAt).getTime()) / 1000);
    return Math.max(0, GRACE_PERIOD_SECONDS - tripAge);
  });

  const fetchStatus = useCallback(() => {
    startTransition(async () => {
      try {
        const result = await getActiveTripStatus();
        if (result.trip) {
          const newStatus = result.trip.status;
          if (newStatus !== trip.status) {
            setStatusChanged(true);
            setTimeout(() => setStatusChanged(false), 2000);
          }
          setTrip(result.trip as TripData);
          setLastUpdated(new Date());
        }
      } catch {
        // Silently fail on poll - will retry next interval
      }
    });
  }, [trip.status]);

  // Grace period countdown timer
  useEffect(() => {
    if (graceTimeLeft <= 0 || trip.status !== 'PENDING') return;

    const timer = setInterval(() => {
      setGraceTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [graceTimeLeft, trip.status]);

  useEffect(() => {
    const interval = setInterval(fetchStatus, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    setCancelError('');
    try {
      const result = await cancelTrip(trip.id);
      if (result.error) {
        setCancelError(result.error);
        setCancelling(false);
        return;
      }
      // Refresh status to show cancelled state
      fetchStatus();
    } catch {
      setCancelError('Failed to cancel trip. Please try again.');
      setCancelling(false);
    }
  };

  const currentStepIndex = STATUS_INDEX[trip.status] ?? 0;
  const showGracePeriod = trip.status === 'PENDING' && graceTimeLeft > 0;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg overflow-hidden">
      {/* Header with live indicator */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          <span className="text-xs font-semibold text-[var(--foreground)] uppercase tracking-wide">
            Live Ride Tracker
          </span>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusColors[trip.status] || ''}`}>
          {trip.status.replace('_', ' ')}
        </span>
      </div>

      {/* Progress Steps */}
      <div className="px-4 py-4">
        <div className="flex items-center justify-between relative">
          {/* Background line */}
          <div className="absolute top-3 left-0 right-0 h-0.5 bg-[var(--border)]" />
          {/* Progress line */}
          <div
            className="absolute top-3 left-0 h-0.5 bg-[var(--primary)] transition-all duration-700 ease-in-out"
            style={{ width: `${(currentStepIndex / (RIDE_STEPS.length - 1)) * 100}%` }}
          />

          {RIDE_STEPS.map((step, index) => {
            const isCompleted = index < currentStepIndex;
            const isCurrent = index === currentStepIndex;
            const isFuture = index > currentStepIndex;

            return (
              <div key={step.key} className="relative flex flex-col items-center z-10" style={{ flex: 1 }}>
                {/* Step circle */}
                <div
                  className={`
                    w-6 h-6 rounded-full flex items-center justify-center text-xs border-2 transition-all duration-500
                    ${isCompleted ? 'bg-[var(--primary)] border-[var(--primary)] text-white' : ''}
                    ${isCurrent ? 'bg-[var(--primary)] border-[var(--primary)] text-white shadow-lg shadow-[var(--primary)]/30' : ''}
                    ${isFuture ? 'bg-[var(--background)] border-[var(--border)] text-[var(--muted)]' : ''}
                  `}
                >
                  {isCompleted ? '✓' : step.icon}
                </div>

                {/* Step label */}
                <span
                  className={`
                    mt-2 text-[10px] font-semibold text-center leading-tight transition-colors duration-300
                    ${isCurrent ? 'text-[var(--primary)]' : ''}
                    ${isCompleted ? 'text-[var(--foreground)]' : ''}
                    ${isFuture ? 'text-[var(--muted)]' : ''}
                  `}
                >
                  {step.label}
                </span>
                {isCurrent && (
                  <span className="text-[9px] text-[var(--muted)] mt-0.5 text-center">
                    {step.description}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Status change animation */}
      {statusChanged && (
        <div className="mx-4 mb-3 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-700 dark:text-blue-400 text-center font-medium animate-pulse">
          Status updated!
        </div>
      )}

      {/* Route info */}
      <div className="px-4 pb-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-[var(--muted)] text-xs">From</span>
            <p className="font-medium text-[var(--foreground)]">{trip.pickupLocation.name}</p>
          </div>
          <div>
            <span className="text-[var(--muted)] text-xs">To</span>
            <p className="font-medium text-[var(--foreground)]">{trip.dropoffLocation.name}</p>
          </div>
        </div>
        <div className="flex justify-between items-center mt-3 pt-3 border-t border-[var(--border)]">
          <span className="text-sm text-[var(--muted)]">
            {trip.passengerCount} passenger{trip.passengerCount > 1 ? 's' : ''} · {trip.rideType.replace('_', ' ')}
          </span>
          <span className="text-sm font-bold text-[var(--foreground)]">₦{trip.totalFare.toLocaleString()}</span>
        </div>
      </div>

      {/* Driver info (shown when accepted or in progress) */}
      {trip.driver && (trip.status === 'ACCEPTED' || trip.status === 'IN_PROGRESS') && (
        <div className="px-4 pb-3 pt-3 border-t border-[var(--border)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--primary)]/10 flex items-center justify-center text-[var(--primary)] text-lg font-bold">
              {trip.driver.user.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--foreground)] truncate">{trip.driver.user.name}</p>
              {trip.driver.vehicle && (
                <p className="text-xs text-[var(--muted)]">
                  {trip.driver.vehicle.make} {trip.driver.vehicle.model} · {trip.driver.vehicle.color} · {trip.driver.vehicle.licensePlate}
                </p>
              )}
              {trip.driver.rating != null && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  {'★'.repeat(Math.round(trip.driver.rating))}{'☆'.repeat(5 - Math.round(trip.driver.rating))}
                  <span className="ml-1 text-[var(--muted)]">({trip.driver.rating.toFixed(1)})</span>
                </p>
              )}
            </div>
          </div>
          {trip.status === 'ACCEPTED' && (
            <div className="mt-3 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 rounded text-xs text-blue-700 dark:text-blue-400 flex items-center gap-2">
              <span className="animate-pulse">●</span>
              <span>Driver is heading to your pickup location</span>
            </div>
          )}
          {trip.status === 'IN_PROGRESS' && (
            <div className="mt-3 px-3 py-2 bg-green-50 dark:bg-green-900/20 rounded text-xs text-green-700 dark:text-green-400 flex items-center gap-2">
              <span>●</span>
              <span>Ride in progress — you&apos;re on your way!</span>
            </div>
          )}
        </div>
      )}

      {/* Waiting for driver message */}
      {trip.status === 'PENDING' && (
        <div className="px-4 pb-3 pt-3 border-t border-[var(--border)]">
          <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 dark:bg-yellow-900/20 rounded text-xs text-yellow-700 dark:text-yellow-400">
            <span className="animate-pulse">●</span>
            <span>Waiting for a driver to accept your request...</span>
          </div>

          {/* Grace period cancellation */}
          {showGracePeriod && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[var(--muted)]">Free cancellation window</span>
                <span className="text-xs font-mono font-bold text-amber-600 dark:text-amber-400">
                  {graceTimeLeft}s
                </span>
              </div>
              {/* Progress bar */}
              <div className="w-full h-1.5 bg-[var(--border)] rounded-full overflow-hidden mb-3">
                <div
                  className="h-full bg-amber-500 transition-all duration-1000 ease-linear"
                  style={{ width: `${(graceTimeLeft / GRACE_PERIOD_SECONDS) * 100}%` }}
                />
              </div>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="w-full py-2.5 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {cancelling ? 'Cancelling...' : 'Cancel Ride (Free)'}
              </button>
              {cancelError && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400 text-center">{cancelError}</p>
              )}
            </div>
          )}

          {/* Expired grace period - show regular cancel (with potential penalty) */}
          {!showGracePeriod && (
            <div className="mt-3">
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="w-full py-2.5 border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-semibold rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
              >
                {cancelling ? 'Cancelling...' : 'Cancel Ride'}
              </button>
              {cancelError && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400 text-center">{cancelError}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* SOS & Refresh */}
      <div className="px-4 pb-4 pt-3 border-t border-[var(--border)] flex gap-3">
        <div className="flex-1">
          <SOSButton />
        </div>
        <button
          onClick={fetchStatus}
          disabled={isPolling}
          className="px-3 py-2 text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] border border-[var(--border)] rounded-lg hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50"
        >
          {isPolling ? '...' : '↻ Refresh'}
        </button>
      </div>

      {/* Last updated */}
      <div className="px-4 pb-3 text-center">
        <span className="text-[10px] text-[var(--muted)]">
          Last updated: {lastUpdated.toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
