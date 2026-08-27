import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { acceptTrip, startTrip, completeTrip, cancelTrip } from '@/lib/actions/trips';

export default async function DriverRidesPage() {
  const session = await auth();
  const userId = (session?.user as { id: string })?.id;

  const driver = await prisma.driver.findUnique({ where: { userId } });

  const activeTrip = driver
    ? await prisma.trip.findFirst({
        where: {
          driverId: driver.id,
          status: { in: ['ACCEPTED', 'IN_PROGRESS'] },
        },
        include: {
          pickupLocation: true,
          dropoffLocation: true,
          student: { include: { user: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
    : null;

  const pendingTrips = driver
    ? await prisma.trip.findMany({
        where: { status: 'PENDING', driverId: null },
        include: {
          pickupLocation: true,
          dropoffLocation: true,
          student: { include: { user: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })
    : [];

  const completedTrips = driver
    ? await prisma.trip.findMany({
        where: { driverId: driver.id, status: 'COMPLETED' },
        include: {
          pickupLocation: true,
          dropoffLocation: true,
          student: { include: { user: true } },
          ratings: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
    : [];

  const cancelledTrips = driver
    ? await prisma.trip.findMany({
        where: { driverId: driver.id, status: 'CANCELLED' },
        include: {
          pickupLocation: true,
          dropoffLocation: true,
          student: { include: { user: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })
    : [];

  const statusColors: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    ACCEPTED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    IN_PROGRESS: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    COMPLETED: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-[var(--foreground)] mb-1">Rides</h1>
      <p className="text-sm text-[var(--muted)] mb-6">Manage your ride requests and history</p>

      {/* Active Ride */}
      {activeTrip && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-[var(--foreground)] mb-2 uppercase tracking-wide">Active Ride</h2>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusColors[activeTrip.status] || ''}`}>
                {activeTrip.status.replace('_', ' ')}
              </span>
              <span className="text-sm font-bold text-[var(--foreground)]">₦{activeTrip.totalFare.toLocaleString()}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-[var(--muted)] text-xs">From</span>
                <p className="font-medium text-[var(--foreground)]">{activeTrip.pickupLocation.name}</p>
              </div>
              <div>
                <span className="text-[var(--muted)] text-xs">To</span>
                <p className="font-medium text-[var(--foreground)]">{activeTrip.dropoffLocation.name}</p>
              </div>
            </div>
            <p className="text-sm text-[var(--muted)] mt-2">
              Passenger: <span className="font-medium text-[var(--foreground)]">{activeTrip.student.user.name}</span> · {activeTrip.passengerCount} pax
            </p>
            <div className="flex gap-2 mt-4 pt-3 border-t border-[var(--border)]">
              {activeTrip.status === 'ACCEPTED' && (
                <form action={async () => { 'use server'; await startTrip(activeTrip.id); }}>
                  <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 transition-colors">
                    Start Ride
                  </button>
                </form>
              )}
              {activeTrip.status === 'IN_PROGRESS' && (
                <form action={async () => { 'use server'; await completeTrip(activeTrip.id); }}>
                  <button type="submit" className="px-4 py-2 bg-[var(--primary)] text-[var(--primary-text)] rounded text-sm font-medium hover:bg-[var(--primary-hover)] transition-colors">
                    Complete Ride
                  </button>
                </form>
              )}
              <form action={async () => { 'use server'; await cancelTrip(activeTrip.id); }}>
                <button type="submit" className="px-4 py-2 border border-[var(--border)] text-[var(--danger)] rounded text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                  Cancel
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Pending Requests */}
      {pendingTrips.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-[var(--foreground)] mb-2 uppercase tracking-wide">Pending Requests</h2>
          <div className="space-y-2">
            {pendingTrips.map((trip) => (
              <div key={trip.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-[var(--foreground)]">{trip.student.user.name}</span>
                  <span className="text-sm font-bold text-[var(--foreground)]">₦{trip.totalFare.toLocaleString()}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                  <div>
                    <span className="text-[var(--muted)] text-xs">From</span>
                    <p className="text-[var(--foreground)]">{trip.pickupLocation.name}</p>
                  </div>
                  <div>
                    <span className="text-[var(--muted)] text-xs">To</span>
                    <p className="text-[var(--foreground)]">{trip.dropoffLocation.name}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--muted)]">{trip.passengerCount} pax · {trip.rideType.replace('_', ' ')}</span>
                  <div className="flex gap-2">
                    <form action={async () => { 'use server'; await acceptTrip(trip.id); }}>
                      <button type="submit" className="px-3 py-1.5 bg-[var(--primary)] text-[var(--primary-text)] rounded text-xs font-medium hover:bg-[var(--primary-hover)] transition-colors">Accept</button>
                    </form>
                    <form action={async () => { 'use server'; await cancelTrip(trip.id); }}>
                      <button type="submit" className="px-3 py-1.5 border border-[var(--border)] text-[var(--muted)] rounded text-xs font-medium hover:bg-[var(--surface-hover)] transition-colors">Decline</button>
                    </form>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completed */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-[var(--foreground)] mb-2 uppercase tracking-wide">Completed Trips</h2>
        {completedTrips.length > 0 ? (
          <div className="space-y-2">
            {completedTrips.map((trip) => (
              <div key={trip.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-[var(--foreground)]">
                    {trip.pickupLocation.name} → {trip.dropoffLocation.name}
                  </span>
                  <span className="text-sm font-bold text-[var(--foreground)]">₦{trip.totalFare.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                  <span>{trip.student.user.name} · {trip.passengerCount} pax</span>
                  <span>{new Date(trip.createdAt).toLocaleDateString()}</span>
                </div>
                {trip.ratings.length > 0 && (
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    Rating: {'★'.repeat(trip.ratings[0].score)}{'☆'.repeat(5 - trip.ratings[0].score)}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 text-center">
            <p className="text-sm text-[var(--muted)]">No completed rides yet.</p>
          </div>
        )}
      </div>

      {/* Cancelled */}
      {cancelledTrips.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-[var(--foreground)] mb-2 uppercase tracking-wide">Cancelled</h2>
          <div className="space-y-2">
            {cancelledTrips.map((trip) => (
              <div key={trip.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3 opacity-60">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--foreground)]">
                    {trip.pickupLocation.name} → {trip.dropoffLocation.name}
                  </span>
                  <span className="text-xs text-[var(--muted)]">{new Date(trip.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
