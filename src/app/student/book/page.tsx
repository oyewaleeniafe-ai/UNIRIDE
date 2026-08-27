'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createTrip } from '@/lib/actions/trips';
import { useOnlineStatus } from '@/hooks/use-online-status';

interface Location {
  id: string;
  name: string;
}

const RIDE_TYPES = [
  { value: 'SOLO_QUICK_CAB', label: 'Solo Quick Cab', desc: 'Direct ride, fastest option' },
  { value: 'SHARED_SHUTTLE', label: 'Shared Shuttle / Carpool', desc: 'Share with other students' },
  { value: 'LATE_NIGHT_SAFE_RIDE', label: 'Late-Night Safe Ride', desc: 'Extra safety for late hours' },
] as const;

const FARE_PER_PASSENGER = 200;

export default function BookRidePage() {
  const router = useRouter();
  const { isOnline } = useOnlineStatus();
  const [locations, setLocations] = useState<Location[]>([]);
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
  const [step, setStep] = useState<'pickup' | 'dropoff' | 'passengers' | 'ridetype' | 'review'>('pickup');

  useEffect(() => {
    fetch('/api/locations')
      .then((r) => r.json())
      .then((data) => setLocations(data.locations || []))
      .catch(() => {});
  }, []);

  const filteredPickup = locations.filter(
    (l) => l.name.toLowerCase().includes(pickupSearch.toLowerCase())
  );
  const filteredDropoff = locations.filter(
    (l) => l.name.toLowerCase().includes(dropoffSearch.toLowerCase()) && l.id !== pickupId
  );

  const selectedPickup = locations.find((l) => l.id === pickupId);
  const selectedDropoff = locations.find((l) => l.id === dropoffId);
  const totalFare = passengerCount * FARE_PER_PASSENGER;

  const handleSubmit = async () => {
    setError('');
    if (!pickupId || !dropoffId) {
      setError('Please select both pickup and drop-off locations.');
      return;
    }
    if (pickupId === dropoffId) {
      setError('Pickup and drop-off locations must be different.');
      return;
    }

    // Check connectivity before submitting
    if (!navigator.onLine) {
      setError('Connection lost. Your booking is waiting for confirmation. Please check your connection and try again.');
      return;
    }

    setLoading(true);
    try {
      const result = await createTrip({
        pickupLocationId: pickupId,
        dropoffLocationId: dropoffId,
        passengerCount,
        rideType: rideType as 'SOLO_QUICK_CAB' | 'SHARED_SHUTTLE' | 'LATE_NIGHT_SAFE_RIDE',
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push('/student/rides');
    } catch {
      setError('Connection lost. Your booking is waiting for confirmation. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 lg:p-6 max-w-lg mx-auto">
      <h1 className="text-xl font-bold text-[var(--foreground)] mb-1">Book a Ride</h1>
      <p className="text-sm text-[var(--muted)] mb-6">Select your pickup and drop-off locations</p>

      {/* Offline warning */}
      {!isOnline && (
        <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-sm text-yellow-800 dark:text-yellow-300">
          ⚠ You are offline. Bookings cannot be submitted until your connection is restored.
        </div>
      )}

      {/* Progress */}
      <div className="flex items-center gap-1 mb-6">
        {['pickup', 'dropoff', 'passengers', 'ridetype', 'review'].map((s, i) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded transition-colors ${
              ['pickup', 'dropoff', 'passengers', 'ridetype', 'review'].indexOf(step) >= i
                ? 'bg-[var(--primary)]'
                : 'bg-[var(--border)]'
            }`}
          />
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Step: Pickup */}
      {step === 'pickup' && (
        <div>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-2">Pickup Location</label>
          <div className="relative">
            <input
              type="text"
              value={pickupSearch}
              onChange={(e) => {
                setPickupSearch(e.target.value);
                setShowPickupDropdown(true);
                setPickupId('');
              }}
              onFocus={() => setShowPickupDropdown(true)}
              placeholder="Search locations..."
              className="w-full px-3 py-2 border border-[var(--border)] rounded-md bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
            {showPickupDropdown && filteredPickup.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-md shadow-lg max-h-60 overflow-auto">
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
                    className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-hover)] text-[var(--foreground)]"
                  >
                    {loc.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => { if (pickupId) setStep('dropoff'); }}
            disabled={!pickupId}
            className="mt-4 w-full py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-md font-medium text-sm hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors"
          >
            Continue
          </button>
        </div>
      )}

      {/* Step: Dropoff */}
      {step === 'dropoff' && (
        <div>
          <button onClick={() => setStep('pickup')} className="text-sm text-[var(--primary)] hover:underline mb-3">&larr; Back</button>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-2">Drop-off Location</label>
          <div className="relative">
            <input
              type="text"
              value={dropoffSearch}
              onChange={(e) => {
                setDropoffSearch(e.target.value);
                setShowDropoffDropdown(true);
                setDropoffId('');
              }}
              onFocus={() => setShowDropoffDropdown(true)}
              placeholder="Search locations..."
              className="w-full px-3 py-2 border border-[var(--border)] rounded-md bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
            {showDropoffDropdown && filteredDropoff.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-md shadow-lg max-h-60 overflow-auto">
                {filteredDropoff.map((loc) => (
                  <button
                    key={loc.id}
                    onClick={() => {
                      setDropoffId(loc.id);
                      setDropoffSearch(loc.name);
                      setShowDropoffDropdown(false);
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-hover)] text-[var(--foreground)]"
                  >
                    {loc.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => { if (dropoffId) setStep('passengers'); }}
            disabled={!dropoffId}
            className="mt-4 w-full py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-md font-medium text-sm hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors"
          >
            Continue
          </button>
        </div>
      )}

      {/* Step: Passengers */}
      {step === 'passengers' && (
        <div>
          <button onClick={() => setStep('dropoff')} className="text-sm text-[var(--primary)] hover:underline mb-3">&larr; Back</button>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-2">Number of Passengers</label>

          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
            <div className="flex items-center justify-center gap-6">
              <button
                onClick={() => setPassengerCount(Math.max(1, passengerCount - 1))}
                className="w-10 h-10 rounded-full border border-[var(--border)] flex items-center justify-center text-lg font-bold hover:bg-[var(--surface-hover)] transition-colors"
              >
                −
              </button>
              <span className="text-3xl font-bold text-[var(--foreground)] w-12 text-center">{passengerCount}</span>
              <button
                onClick={() => setPassengerCount(Math.min(10, passengerCount + 1))}
                className="w-10 h-10 rounded-full border border-[var(--border)] flex items-center justify-center text-lg font-bold hover:bg-[var(--surface-hover)] transition-colors"
              >
                +
              </button>
            </div>

            <div className="mt-4 text-center">
              <p className="text-sm text-[var(--muted)]">Fare per student: ₦{FARE_PER_PASSENGER.toLocaleString()}</p>
              <p className="text-lg font-bold text-[var(--foreground)] mt-1">Total: ₦{totalFare.toLocaleString()}</p>
              <p className="text-xs text-[var(--muted)]">Each student pays ₦{FARE_PER_PASSENGER.toLocaleString()}</p>
            </div>
          </div>

          <button
            onClick={() => setStep('ridetype')}
            className="mt-4 w-full py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-md font-medium text-sm hover:bg-[var(--primary-hover)] transition-colors"
          >
            Continue
          </button>
        </div>
      )}

      {/* Step: Ride Type */}
      {step === 'ridetype' && (
        <div>
          <button onClick={() => setStep('passengers')} className="text-sm text-[var(--primary)] hover:underline mb-3">&larr; Back</button>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-2">Ride Type</label>

          <div className="space-y-2">
            {RIDE_TYPES.map((rt) => (
              <button
                key={rt.value}
                onClick={() => setRideType(rt.value)}
                className={`w-full p-3 rounded-lg border text-left transition-colors ${
                  rideType === rt.value
                    ? 'border-[var(--primary)] bg-[var(--primary)] bg-opacity-5'
                    : 'border-[var(--border)] hover:border-[var(--muted)]'
                }`}
              >
                <p className="text-sm font-medium text-[var(--foreground)]">{rt.label}</p>
                <p className="text-xs text-[var(--muted)]">{rt.desc}</p>
              </button>
            ))}
          </div>

          <button
            onClick={() => setStep('review')}
            className="mt-4 w-full py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-md font-medium text-sm hover:bg-[var(--primary-hover)] transition-colors"
          >
            Continue
          </button>
        </div>
      )}

      {/* Step: Review */}
      {step === 'review' && (
        <div>
          <button onClick={() => setStep('ridetype')} className="text-sm text-[var(--primary)] hover:underline mb-3">&larr; Back</button>
          <h2 className="text-sm font-medium text-[var(--foreground)] mb-3">Review Your Booking</h2>

          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-[var(--muted)]">Pickup</span>
              <span className="font-medium text-[var(--foreground)]">{selectedPickup?.name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[var(--muted)]">Drop-off</span>
              <span className="font-medium text-[var(--foreground)]">{selectedDropoff?.name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[var(--muted)]">Passengers</span>
              <span className="font-medium text-[var(--foreground)]">{passengerCount}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[var(--muted)]">Ride type</span>
              <span className="font-medium text-[var(--foreground)]">
                {RIDE_TYPES.find((r) => r.value === rideType)?.label}
              </span>
            </div>
            <div className="pt-3 border-t border-[var(--border)] flex justify-between">
              <span className="text-sm font-medium text-[var(--foreground)]">Total fare</span>
              <span className="text-lg font-bold text-[var(--foreground)]">₦{totalFare.toLocaleString()}</span>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading || !isOnline}
            className="mt-4 w-full py-3 bg-[var(--primary)] text-[var(--primary-text)] rounded-md font-medium text-sm hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors"
          >
            {loading ? 'Confirming...' : !isOnline ? 'Offline — Cannot Book' : 'Confirm Booking'}
          </button>
        </div>
      )}
    </div>
  );
}
