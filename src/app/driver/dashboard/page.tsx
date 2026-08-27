import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { toggleDriverOnline } from '@/lib/actions/driver';
import OnlineToggle from './OnlineToggle';

export default async function DriverDashboard() {
  const session = await auth();
  const userId = (session?.user as { id: string })?.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      driver: {
        include: {
          vehicle: true,
          inspections: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      },
    },
  });

  const driver = user?.driver;
  const latestInspection = driver?.inspections?.[0];
  const isInspectionComplete = latestInspection?.status === 'COMPLETED';

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
        where: {
          status: 'PENDING',
          driverId: null,
        },
        include: {
          pickupLocation: true,
          dropoffLocation: true,
          student: { include: { user: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      })
    : [];

  const completedTrips = driver
    ? await prisma.trip.findMany({
        where: { driverId: driver.id, status: 'COMPLETED' },
        include: {
          pickupLocation: true,
          dropoffLocation: true,
          student: { include: { user: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      })
    : [];

  const totalEarnings = driver
    ? (await prisma.trip.aggregate({
        where: { driverId: driver.id, status: 'COMPLETED' },
        _sum: { totalFare: true },
      }))._sum.totalFare || 0
    : 0;

  const notifications = await prisma.notification.findMany({
    where: { userId, isRead: false },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--foreground)]">
            Welcome, {user?.name || 'Driver'}
          </h1>
          <p className="text-sm text-[var(--muted)] mt-0.5">
            ID: {driver?.driverId} · {user?.phone}
          </p>
        </div>
        <OnlineToggle
          initialOnline={driver?.isOnline || false}
          isInspectionComplete={isInspectionComplete}
        />
      </div>

      {/* Vehicle & Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
          <h3 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide mb-2">Vehicle</h3>
          {driver?.vehicle ? (
            <>
              <p className="text-sm font-medium text-[var(--foreground)]">
                {driver.vehicle.make} {driver.vehicle.model}
              </p>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                {driver.vehicle.color} · {driver.vehicle.licensePlate}
              </p>
            </>
          ) : (
            <p className="text-sm text-[var(--muted)]">No vehicle registered</p>
          )}
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
          <h3 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide mb-2">Status</h3>
          <p className="text-sm font-medium text-[var(--foreground)]">
            {driver?.isOnline ? '● Online' : '○ Offline'}
          </p>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Inspection: {isInspectionComplete ? '✓ Complete' : '✗ Incomplete'}
          </p>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
          <h3 className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide mb-2">Earnings</h3>
          <p className="text-2xl font-bold text-[var(--foreground)]">₦{totalEarnings.toLocaleString()}</p>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {driver?.totalTrips || 0} completed trips
          </p>
        </div>
      </div>

      {/* Inspection Warning */}
      {!isInspectionComplete && driver?.isOnline === false && (
        <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <p className="text-sm text-yellow-800 dark:text-yellow-300 font-medium">
            Complete your vehicle inspection before going online.
          </p>
          <Link href="/driver/inspection" className="text-xs text-[var(--primary)] hover:underline mt-1 inline-block">
            Go to inspection →
          </Link>
        </div>
      )}

      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-[var(--foreground)] mb-2 uppercase tracking-wide">Notifications</h2>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
            {notifications.map((n) => (
              <div key={n.id} className="p-3">
                <p className="text-sm font-medium text-[var(--foreground)]">{n.title}</p>
                <p className="text-xs text-[var(--muted)] mt-0.5">{n.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Ride */}
      {activeTrip && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-[var(--foreground)] mb-2 uppercase tracking-wide">Active Ride</h2>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                activeTrip.status === 'ACCEPTED' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
              }`}>
                {activeTrip.status.replace('_', ' ')}
              </span>
              <span className="text-xs text-[var(--muted)]">
                ₦{activeTrip.totalFare.toLocaleString()}
              </span>
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
              Passenger: <span className="font-medium text-[var(--foreground)]">{activeTrip.student.user.name}</span>
            </p>
          </div>
        </div>
      )}

      {/* Pending Ride Requests */}
      {driver?.isOnline && pendingTrips.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-[var(--foreground)] mb-2 uppercase tracking-wide">Incoming Requests</h2>
          <div className="space-y-2">
            {pendingTrips.map((trip) => (
              <TripRequest key={trip.id} trip={trip} />
            ))}
          </div>
        </div>
      )}

      {/* Recent Completed */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-[var(--foreground)] uppercase tracking-wide">Recent Completed</h2>
          <Link href="/driver/rides" className="text-xs text-[var(--primary)] hover:underline">View all</Link>
        </div>
        {completedTrips.length > 0 ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
            {completedTrips.map((trip) => (
              <div key={trip.id} className="p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--foreground)] truncate">
                    {trip.pickupLocation.name} → {trip.dropoffLocation.name}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {trip.student.user.name} · {trip.passengerCount} pax
                  </p>
                </div>
                <span className="text-sm font-bold text-[var(--foreground)] whitespace-nowrap ml-3">
                  ₦{trip.totalFare.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 text-center">
            <p className="text-sm text-[var(--muted)]">No completed rides yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TripRequest({ trip }: { trip: { id: string; pickupLocation: { name: string }; dropoffLocation: { name: string }; passengerCount: number; totalFare: number; rideType: string; student: { user: { name: string } } } }) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
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
        <span className="text-xs text-[var(--muted)]">
          {trip.passengerCount} pax · {trip.rideType.replace('_', ' ')}
        </span>
        <AcceptRejectButtons tripId={trip.id} />
      </div>
    </div>
  );
}

function AcceptRejectButtons({ tripId }: { tripId: string }) {
  return (
    <div className="flex gap-2">
      <form action={async () => { 'use server'; }}>
        <button
          type="submit"
          formAction={async () => {
            'use server';
            const { acceptTrip } = await import('@/lib/actions/trips');
            await acceptTrip(tripId);
          }}
          className="px-3 py-1.5 bg-[var(--primary)] text-[var(--primary-text)] rounded text-xs font-medium hover:bg-[var(--primary-hover)] transition-colors"
        >
          Accept
        </button>
      </form>
      <form action={async () => {
        'use server';
        const { rejectTrip } = await import('@/lib/actions/trips');
        await rejectTrip(tripId);
      }}>
        <button
          type="submit"
          className="px-3 py-1.5 border border-[var(--border)] text-[var(--muted)] rounded text-xs font-medium hover:bg-[var(--surface-hover)] transition-colors"
        >
          Decline
        </button>
      </form>
    </div>
  );
}
