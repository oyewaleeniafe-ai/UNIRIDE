'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createTrip } from '@/lib/actions/trips';
import { initializePayment } from '@/lib/actions/payments';
import { useOnlineStatus } from '@/hooks/use-online-status';
import Spinner from '@/components/spinner';
import { MapPin, Flag, ArrowLeft, ArrowRight, CarFront, Users, AlertTriangle, Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface Location {
  id: string;
  name: string;
}

const RIDE_TYPES = [
  { value: 'SOLO_QUICK_CAB', label: 'Solo Cab', desc: 'Direct ride, fastest option · ₦800 fixed', icon: CarFront },
  { value: 'SHARED_SHUTTLE', label: 'Shared Shuttle', desc: 'Share with other students · ₦200 fixed', icon: Users },
] as const;

// Display-only mirror of the server-side fixed fares (src/lib/paystack.ts is
// the source of truth — the server recomputes the real amount on booking).
const RIDE_FARES: Record<string, number> = {
  SOLO_QUICK_CAB: 800,
  SHARED_SHUTTLE: 200,
};
const SERVICE_FEE = 30;

const STEPS = ['pickup', 'dropoff', 'ridetype', 'passengers', 'review'] as const;

/* Module-scope presentational components (hoisted so they are not recreated
   on every render). */
function LocationField({
  label,
  value,
  onChange,
  onFocus,
  icon: Icon,
  tint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFocus: () => void;
  icon: LucideIcon;
  tint: string;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">{label}</label>
      <div className="relative">
        <span className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${tint}`}>
          <Icon className="w-[18px] h-[18px]" />
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          placeholder="Type to search campus locations…"
          className="cc-input pl-11"
        />
      </div>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)] transition-colors mb-4"
    >
      <ArrowLeft className="w-4 h-4" />
      Back
    </button>
  );
}

export default function BookRidePage() {
  const router = useRouter();
  const { isOnline } = useOnlineStatus();
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [locationsError, setLocationsError] = useState('');
  const [pickupId, setPickupId] = useState('');
  const [dropoffId, setDropoffId] = useState('');
  const [passengerCount, setPassengerCount] = useState(1);
  const [rideType, setRideType] = useState<string>('SOLO_QUICK_CAB');
  const [pickupSearch, setPickupSearch] = useState('');
  const [dropoffSearch, setDropoffSearch] = useState('');
  const [showPickupDropdown, setShowPickupDropdown] = useState(false);
  const [showDropoffDropdown, setShowDropoffDropdown] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [step, setStep] = useState<'pickup' | 'dropoff' | 'passengers' | 'ridetype' | 'review'>('pickup');

  const fetchLocations = useCallback(async () => {
    setLocationsLoading(true);
    setLocationsError('');
    try {
      const res = await fetch('/api/locations');
      if (!res.ok) throw new Error('Failed to load locations');
      const data = await res.json();
      setLocations(data.locations || []);
    } catch {
      setLocationsError('Could not load campus locations. Pull down to retry.');
    } finally {
      setLocationsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  const filteredPickup = locations.filter(
    (l) => l.name.toLowerCase().includes(pickupSearch.toLowerCase())
  );
  const filteredDropoff = locations.filter(
    (l) => l.name.toLowerCase().includes(dropoffSearch.toLowerCase()) && l.id !== pickupId
  );

  const selectedPickup = locations.find((l) => l.id === pickupId);
  const selectedDropoff = locations.find((l) => l.id === dropoffId);

  // Client-side fare display for the selected ride type (fixed prices).
  // The server recalculates and validates the real amount on booking.
  const rideFare = RIDE_FARES[rideType] ?? 0;
  const totalAmount = rideFare + SERVICE_FEE;

  const handleSubmit = async () => {
    setError('');
    if (!pickupId || !dropoffId) {
      setError('Please select both a pickup and drop-off location before continuing.');
      return;
    }
    if (pickupId === dropoffId) {
      setError('Pickup and drop-off must be different locations. Please go back and change one.');
      return;
    }

    if (!navigator.onLine) {
      setError('You appear to be offline. Please check your internet connection and try again.');
      return;
    }

    setLoading(true);
    try {
      // Step 1: Create the trip
      const tripResult = await createTrip({
        pickupLocationId: pickupId,
        dropoffLocationId: dropoffId,
        passengerCount,
        rideType: rideType as 'SOLO_QUICK_CAB' | 'SHARED_SHUTTLE',
      });

      if (tripResult.error) {
        setError(tripResult.error);
        setLoading(false);
        return;
      }

      // Step 2: Initialize payment with Paystack
      if (tripResult.trip) {
        const paymentResult = await initializePayment(tripResult.trip.id);

        if (paymentResult.error) {
          setError(paymentResult.error);
          setLoading(false);
          return;
        }

        // Step 3: Redirect to Paystack checkout
        if ('authorizationUrl' in paymentResult && paymentResult.authorizationUrl) {
          const authUrl = paymentResult.authorizationUrl;
          // Redirect to Paystack
          window.location.href = authUrl;
          return;
        }

        // If no auth URL (payment already verified), just redirect to rides
        setSuccess(true);
        setTimeout(() => router.push('/student/rides'), 1500);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
        setError('Could not reach the server. Please check your connection and try again.');
      } else {
        setError('Something went wrong while booking your ride. Please try again.');
      }
      setLoading(false);
    }
  };

  const handleRetry = () => {
    setError('');
    handleSubmit();
  };

  // ── Success overlay ──
  if (success) {
    return (
      <div className="p-4 lg:p-6 max-w-lg mx-auto flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4 animate-bounce-in">
          <Check className="w-8 h-8 text-green-600 dark:text-green-400" strokeWidth={2.5} />
        </div>
        <h2 className="text-lg font-bold text-[var(--foreground)] mb-1">Booking Confirmed!</h2>
        <p className="text-sm text-[var(--muted)]">Your ride has been requested. Redirecting…</p>
        <div className="mt-4">
          <Spinner size="md" className="text-[var(--primary)]" />
        </div>
      </div>
    );
  }

  // ── Location loading state ──
  if (locationsLoading) {
    return (
      <div className="p-4 lg:p-6 max-w-lg mx-auto">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)] mb-1">Book a Ride</h1>
        <p className="text-sm text-[var(--muted)] mb-6">Select your pickup and drop-off locations</p>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Spinner size="lg" className="text-[var(--primary)] mb-4" />
          <p className="text-sm text-[var(--muted)]">Loading campus locations…</p>
        </div>
      </div>
    );
  }

  // ── Location load error ──
  if (locationsError) {
    return (
      <div className="p-4 lg:p-6 max-w-lg mx-auto">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)] mb-1">Book a Ride</h1>
        <p className="text-sm text-[var(--muted)] mb-6">Select your pickup and drop-off locations</p>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-900/30 flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-[var(--danger)]" />
          </div>
          <p className="text-sm text-[var(--foreground)] font-medium mb-1">Unable to load locations</p>
          <p className="text-xs text-[var(--muted)] mb-4">{locationsError}</p>
          <button onClick={fetchLocations} className="cc-btn-primary">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)] mb-1">Book a Ride</h1>
      <p className="text-sm text-[var(--muted)] mb-6">Select your pickup and drop-off locations</p>

      {/* Offline warning */}
      {!isOnline && (
        <div className="mb-4 p-3.5 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl text-sm text-yellow-800 dark:text-yellow-300 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">You are offline</p>
            <p className="text-xs mt-0.5">Bookings require an internet connection. Your selections are saved — submit when you&apos;re back online.</p>
          </div>
        </div>
      )}

      {/* Progress */}
      <div className="flex items-center gap-1.5 mb-7">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
              STEPS.indexOf(step) >= i ? 'bg-[var(--primary)]' : 'bg-[var(--border-color)]'
            }`}
          />
        ))}
      </div>

      {/* Error banner with retry */}
      {error && (
        <div className="mb-4 p-3.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p>{error}</p>
              {loading === false && (
                <button
                  onClick={handleRetry}
                  className="mt-2 text-xs font-semibold text-red-700 dark:text-red-400 underline hover:no-underline"
                >
                  Retry booking
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step: Pickup */}
      {step === 'pickup' && (
        <div className="cc-card rounded-2xl p-5">
          <LocationField
            label="Pickup Location"
            value={pickupSearch}
            onChange={(v) => {
              setPickupSearch(v);
              setShowPickupDropdown(true);
              setPickupId('');
            }}
            onFocus={() => setShowPickupDropdown(true)}
            icon={MapPin}
            tint="text-[var(--primary)]"
          />
          {showPickupDropdown && pickupSearch && filteredPickup.length === 0 && (
            <div className="mt-2 p-3 rounded-xl border border-[var(--border-color)] bg-[var(--surface)] text-center">
              <p className="text-xs text-[var(--muted)]">No locations matching &ldquo;{pickupSearch}&rdquo;</p>
            </div>
          )}
          {showPickupDropdown && locations.length === 0 && (
            <p className="text-xs text-[var(--muted)] mt-1">No campus locations available.</p>
          )}
          {showPickupDropdown && filteredPickup.length > 0 && (
            <div className="mt-2 -m-1 pt-1 border-t border-[var(--border-color)] max-h-60 overflow-auto">
              {filteredPickup.map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => {
                    setPickupId(loc.id);
                    setPickupSearch(loc.name);
                    setShowPickupDropdown(false);
                    setDropoffSearch('');
                    setDropoffId('');
                  }}
                  className="w-full px-3 py-2.5 mt-1 text-left text-sm rounded-lg hover:bg-[var(--surface-hover)] text-[var(--foreground)] transition-colors flex items-center gap-2"
                >
                  <MapPin className="w-4 h-4 text-[var(--muted-fg)]" />
                  {loc.name}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => { if (pickupId) setStep('dropoff'); }}
            disabled={!pickupId}
            className="cc-btn-primary w-full mt-5"
          >
            Continue
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Step: Dropoff */}
      {step === 'dropoff' && (
        <div className="cc-card rounded-2xl p-5">
          <BackButton onClick={() => setStep('pickup')} />
          <LocationField
            label="Drop-off Location"
            value={dropoffSearch}
            onChange={(v) => {
              setDropoffSearch(v);
              setShowDropoffDropdown(true);
              setDropoffId('');
            }}
            onFocus={() => setShowDropoffDropdown(true)}
            icon={Flag}
            tint="text-[var(--muted-fg)]"
          />
          {showDropoffDropdown && dropoffSearch && filteredDropoff.length === 0 && (
            <div className="mt-2 p-3 rounded-xl border border-[var(--border-color)] bg-[var(--surface)] text-center">
              <p className="text-xs text-[var(--muted)]">No locations matching &ldquo;{dropoffSearch}&rdquo;</p>
            </div>
          )}
          {showDropoffDropdown && filteredDropoff.length > 0 && (
            <div className="mt-2 -m-1 pt-1 border-t border-[var(--border-color)] max-h-60 overflow-auto">
              {filteredDropoff.map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => {
                    setDropoffId(loc.id);
                    setDropoffSearch(loc.name);
                    setShowDropoffDropdown(false);
                  }}
                  className="w-full px-3 py-2.5 mt-1 text-left text-sm rounded-lg hover:bg-[var(--surface-hover)] text-[var(--foreground)] transition-colors flex items-center gap-2"
                >
                  <Flag className="w-4 h-4 text-[var(--muted-fg)]" />
                  {loc.name}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => { if (dropoffId) setStep('ridetype'); }}
            disabled={!dropoffId}
            className="cc-btn-primary w-full mt-5"
          >
            Continue
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Step: Passengers (fare is fixed per ride type — passenger count
          no longer affects the price) */}
      {step === 'passengers' && (
        <div className="cc-card rounded-2xl p-5">
          <BackButton onClick={() => setStep('ridetype')} />
          <label className="block text-sm font-semibold text-[var(--foreground)] mb-4">Number of Passengers</label>

          <div className="flex items-center justify-center gap-8 py-2">
            <button
              onClick={() => setPassengerCount(Math.max(1, passengerCount - 1))}
              className="w-12 h-12 rounded-full border border-[var(--border-color)] bg-[var(--surface)] flex items-center justify-center text-xl font-bold text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-40"
              disabled={passengerCount <= 1}
            >
              −
            </button>
            <span className="text-4xl font-bold text-[var(--foreground)] w-14 text-center">{passengerCount}</span>
            <button
              onClick={() => setPassengerCount(Math.min(10, passengerCount + 1))}
              className="w-12 h-12 rounded-full border border-[var(--border-color)] bg-[var(--surface)] flex items-center justify-center text-xl font-bold text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-40"
              disabled={passengerCount >= 10}
            >
              +
            </button>
          </div>

          <button
            onClick={() => setStep('review')}
            className="cc-btn-primary w-full mt-5"
          >
            Continue
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Step: Ride Type (chosen before the amount/fare) */}
      {step === 'ridetype' && (
        <div className="cc-card rounded-2xl p-5">
          <BackButton onClick={() => setStep('dropoff')} />
          <label className="block text-sm font-semibold text-[var(--foreground)] mb-3">Ride Type</label>

          {/* Icon-tile selector (reference pattern): filled primary tile = active */}
          <div className="grid grid-cols-2 gap-3">
            {RIDE_TYPES.map((rt) => {
              const Icon = rt.icon;
              const selected = rideType === rt.value;
              return (
                <button
                  key={rt.value}
                  onClick={() => setRideType(rt.value)}
                  aria-pressed={selected}
                  className={`flex flex-col items-center gap-2 p-4 rounded-2xl border text-center transition-all ${
                    selected
                      ? 'border-[var(--primary)] ring-2 ring-[var(--primary-soft)] bg-[var(--primary-soft)]'
                      : 'border-[var(--border-color)] hover:border-[var(--muted-fg)] bg-[var(--surface)]'
                  }`}
                >
                  <span
                    className={`inline-flex items-center justify-center w-12 h-12 rounded-xl shrink-0 ${
                      selected
                        ? 'bg-[var(--primary)] text-[var(--primary-text)]'
                        : 'cc-icon-tile'
                    }`}
                  >
                    <Icon className="w-6 h-6" />
                  </span>
                  <span className="text-sm font-semibold text-[var(--foreground)]">{rt.label}</span>
                  <span className="text-[11px] leading-snug text-[var(--muted)]">{rt.desc}</span>
                </button>
              );
            })}
          </div>

          {/* Amount/Fare — reflects the selected ride type (fixed prices) */}
          <div className="mt-4 rounded-xl bg-[var(--surface-2)] border border-[var(--border-color)] p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-[var(--muted)]">Ride fare</span>
              <span className="font-medium text-[var(--foreground)]">₦{rideFare.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[var(--muted)]">Service Fee</span>
              <span className="font-medium text-[var(--foreground)]">₦{SERVICE_FEE}</span>
            </div>
            <div className="pt-2.5 border-t border-[var(--border-color)] flex justify-between items-center">
              <span className="text-sm font-semibold text-[var(--foreground)]">Total</span>
              <span className="text-xl font-bold text-[var(--foreground)]">₦{totalAmount.toLocaleString()}</span>
            </div>
          </div>

          <button
            onClick={() => setStep('passengers')}
            className="cc-btn-primary w-full mt-5"
          >
            Continue
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Step: Review & Pay */}
      {step === 'review' && (
        <div className="cc-card rounded-2xl p-5">
          <BackButton onClick={() => setStep('ridetype')} />
          <h2 className="text-sm font-semibold text-[var(--foreground)] mb-4">Review &amp; Pay</h2>

          {/* Route summary */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex flex-col items-center">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--primary)]" />
              <span className="w-px h-8 border-l border-dashed border-[var(--border-color)] my-0.5" />
              <span className="w-2.5 h-2.5 rounded-full border-2 border-[var(--muted-fg)]" />
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <p className="text-sm font-medium text-[var(--foreground)] truncate">{selectedPickup?.name}</p>
              <p className="text-sm font-medium text-[var(--foreground)] truncate">{selectedDropoff?.name}</p>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Passengers</span>
              <span className="font-medium text-[var(--foreground)]">{passengerCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--muted)]">Ride type</span>
              <span className="font-medium text-[var(--foreground)]">
                {RIDE_TYPES.find((r) => r.value === rideType)?.label}
              </span>
            </div>
          </div>

          {/* Payment breakdown */}
          <div className="mt-4 rounded-xl bg-[var(--surface-2)] border border-[var(--border-color)] p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-[var(--muted)]">Ride fare</span>
              <span className="font-medium text-[var(--foreground)]">₦{rideFare.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[var(--muted)]">Service Fee</span>
              <span className="font-medium text-[var(--foreground)]">₦{SERVICE_FEE}</span>
            </div>
            <div className="flex justify-between pt-2.5 border-t border-[var(--border-color)] items-center">
              <span className="text-sm font-semibold text-[var(--foreground)]">Total</span>
              <span className="text-xl font-bold text-[var(--foreground)]">₦{totalAmount.toLocaleString()}</span>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading || !isOnline}
            className="cc-btn-primary w-full mt-5"
          >
            {loading ? (
              <>
                <Spinner size="sm" className="text-[var(--primary-text)]" />
                <span>Processing payment…</span>
              </>
            ) : !isOnline ? (
              <span>Offline — Cannot Pay</span>
            ) : (
              <span>Pay ₦{totalAmount.toLocaleString()} with Paystack</span>
            )}
          </button>

          {!isOnline && (
            <p className="text-xs text-[var(--muted)] text-center mt-3">
              Reconnect to the internet to submit this booking.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
