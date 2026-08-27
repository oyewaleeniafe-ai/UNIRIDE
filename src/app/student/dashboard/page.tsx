import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import AuditLogViewer from './audit-log';

export default async function StudentDashboard() {
  const session = await auth();
  const userId = (session?.user as { id: string })?.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      student: true,
    },
  });

  const studentId = user?.student?.id;

  const activeTrip = await prisma.trip.findFirst({
    where: {
      studentId: studentId || '__none__',
      status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] },
    },
    include: {
      pickupLocation: true,
      dropoffLocation: true,
      driver: { include: { user: true, vehicle: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const recentTrips = await prisma.trip.findMany({
    where: { studentId: studentId || '__none__', status: 'COMPLETED' },
    include: {
      pickupLocation: true,
      dropoffLocation: true,
      driver: { include: { user: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  const notifications = await prisma.notification.findMany({
    where: { userId, isRead: false },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  const totalTrips = await prisma.trip.count({
    where: { studentId: studentId || '__none__', status: 'COMPLETED' },
  });

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--foreground)]">
          Welcome, {user?.name || 'Student'}
        </h1>
        <p className="text-sm text-[var(--muted)] mt-0.5">
          {user?.student?.matricNo} · {user?.phone}
        </p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Link href="/student/book" className="bg-[var(--primary)] text-[var(--primary-text)] p-4 rounded-lg hover:opacity-90 transition-opacity">
          <div className="text-lg font-bold">⊕</div>
          <div className="text-sm font-medium">Book Ride</div>
        </Link>
        <Link href="/student/rides" className="bg-[var(--surface)] border border-[var(--border)] p-4 rounded-lg hover:bg-[var(--surface-hover)] transition-colors">
          <div className="text-lg font-bold">◈</div>
          <div className="text-sm font-medium text-[var(--foreground)]">My Rides</div>
          <div className="text-xs text-[var(--muted)]">{totalTrips} completed</div>
        </Link>
        <Link href="/student/profile" className="bg-[var(--surface)] border border-[var(--border)] p-4 rounded-lg hover:bg-[var(--surface-hover)] transition-colors">
          <div className="text-lg font-bold">☺</div>
          <div className="text-sm font-medium text-[var(--foreground)]">Profile</div>
        </Link>
        <SOSButton />
      </div>

      {/* Active Ride */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-[var(--foreground)] mb-2 uppercase tracking-wide">Current Ride</h2>
        {activeTrip ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                activeTrip.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                activeTrip.status === 'ACCEPTED' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
              }`}>
                {activeTrip.status.replace('_', ' ')}
              </span>
              <span className="text-xs text-[var(--muted)]">
                {new Date(activeTrip.createdAt).toLocaleTimeString()}
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
            {activeTrip.driver && (
              <div className="mt-3 pt-3 border-t border-[var(--border)]">
                <p className="text-sm text-[var(--foreground)]">
                  Driver: <span className="font-medium">{activeTrip.driver.user.name}</span>
                </p>
                {activeTrip.driver.vehicle && (
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    {activeTrip.driver.vehicle.make} {activeTrip.driver.vehicle.model} · {activeTrip.driver.vehicle.licensePlate}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 text-center">
            <p className="text-sm text-[var(--muted)]">No active ride. Ready to book?</p>
            <Link href="/student/book" className="inline-block mt-2 text-sm text-[var(--primary)] hover:underline">
              Book a ride →
            </Link>
          </div>
        )}
      </div>

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

      {/* Recent Trips */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-[var(--foreground)] uppercase tracking-wide">Recent Trips</h2>
          <Link href="/student/rides" className="text-xs text-[var(--primary)] hover:underline">View all</Link>
        </div>
        {recentTrips.length > 0 ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
            {recentTrips.map((trip) => (
              <div key={trip.id} className="p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--foreground)] truncate">
                    {trip.pickupLocation.name} → {trip.dropoffLocation.name}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {trip.passengerCount} passenger{trip.passengerCount > 1 ? 's' : ''} · ₦{trip.totalFare.toLocaleString()}
                  </p>
                </div>
                <span className="text-xs text-[var(--muted)] whitespace-nowrap ml-3">
                  {new Date(trip.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 text-center">
            <p className="text-sm text-[var(--muted)]">You haven&apos;t booked a ride yet.</p>
          </div>
        )}
      </div>

      {/* Audit Log */}
      <div className="mt-6">
        <AuditLogViewer />
      </div>
    </div>
  );
}

function SOSButton() {
  return (
    <Link href="/student/dashboard#sos" className="bg-[var(--danger)] text-white p-4 rounded-lg hover:bg-[var(--danger-hover)] transition-colors">
      <div className="text-lg font-bold">⚠</div>
      <div className="text-sm font-medium">SOS</div>
    </Link>
  );
}
