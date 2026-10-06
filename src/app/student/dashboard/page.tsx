import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import AuditLogViewer from './audit-log';
import SOSButton from '@/components/sos-button';
import ActiveRideTracker from '@/components/active-ride-tracker';
import BackgroundSlideshow from '@/components/background-slideshow';
import { Navigation, MapPin, Flag, ArrowRight, ArrowUpDown, CarFront, Route, User, Bell } from 'lucide-react';

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
      studentId: studentId || '00000000-0000-4000-8000-0000000000ff',
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
    where: { studentId: studentId || '00000000-0000-4000-8000-0000000000ff', status: 'COMPLETED' },
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
    where: { studentId: studentId || '00000000-0000-4000-8000-0000000000ff', status: 'COMPLETED' },
  });

  const firstName = (user?.name || 'Student').split(' ')[0];

  return (
    <div className="relative z-10 p-4 lg:p-8 max-w-5xl mx-auto">
      {/* Decorative CampusCab background — fixed layer behind all dashboard content */}
      <BackgroundSlideshow
        className="fixed inset-0 -z-10"
        overlayClassName="cc-dashboard-scrim"
      />

      {/* Profile header — greeting sits directly on the backdrop like the reference */}
      <div className="flex items-center gap-3.5 mb-5">
        <div className="w-12 h-12 rounded-full bg-[var(--primary)] text-[var(--primary-text)] flex items-center justify-center text-lg font-bold shadow-[var(--shadow-md)]">
          {(user?.name || 'S').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--muted)]">
            Hi, {firstName} 👋
          </p>
          <p className="text-xs text-[var(--muted-fg)] truncate">
            {user?.student?.matricNo} · {user?.phone}
          </p>
        </div>
      </div>

      {/* Hero — "Where are you going?" with From/To split cards (reference layout).
          Shows the live active-ride locations when one exists, otherwise the
          booking entry points — same links, no new behaviour. */}
      <div className="mb-6">
        <h1 className="text-[28px] leading-tight font-extrabold tracking-tight text-[var(--foreground)] cc-text-lift">
          Where are you{' '}
          <span className="text-[var(--primary)]">going?</span>
        </h1>

        <div className="cc-card rounded-2xl p-4 lg:p-5 mt-4">
          <div className="relative flex flex-col sm:flex-row gap-3">
            <Link
              href="/student/book"
              className="flex-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border-color)] p-3.5 min-w-0 hover:border-[var(--primary)] transition-colors"
            >
              <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
                <MapPin className="w-3.5 h-3.5 text-[var(--primary)]" />
                From
              </span>
              <span className="block mt-1.5 text-[15px] font-bold text-[var(--foreground)] truncate">
                {activeTrip ? activeTrip.pickupLocation.name : 'Select pickup'}
              </span>
              {!activeTrip && (
                <span className="block text-xs text-[var(--muted-fg)] mt-0.5">Campus location</span>
              )}
            </Link>

            <span
              className="hidden sm:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-[var(--surface)] border border-[var(--border-color)] shadow-[var(--shadow-sm)] items-center justify-center text-[var(--muted)]"
              aria-hidden
            >
              <ArrowUpDown className="w-4 h-4" />
            </span>

            <Link
              href="/student/book"
              className="flex-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border-color)] p-3.5 min-w-0 hover:border-[var(--primary)] transition-colors sm:text-right"
            >
              <span className="flex items-center sm:justify-end gap-1.5 text-xs font-medium text-[var(--muted)]">
                To
                <Flag className="w-3.5 h-3.5 text-[var(--muted-fg)]" />
              </span>
              <span className="block mt-1.5 text-[15px] font-bold text-[var(--foreground)] truncate">
                {activeTrip ? activeTrip.dropoffLocation.name : 'Select destination'}
              </span>
              {!activeTrip && (
                <span className="block text-xs text-[var(--muted-fg)] mt-0.5">Campus location</span>
              )}
            </Link>
          </div>

          <Link href="/student/book" className="cc-btn-primary w-full mt-3.5">
            Book a Ride
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Link
          href="/student/book"
          className="cc-card cc-card-hover rounded-2xl p-4 flex flex-col gap-2.5"
        >
          <span className="cc-icon-tile w-10 h-10">
            <CarFront className="w-5 h-5" />
          </span>
          <div>
            <div className="text-sm font-semibold text-[var(--foreground)]">Book Ride</div>
            <div className="text-xs text-[var(--muted)] mt-0.5">Solo Cab · Shared Shuttle</div>
          </div>
        </Link>
        <Link
          href="/student/rides"
          className="cc-card cc-card-hover rounded-2xl p-4 flex flex-col gap-2.5"
        >
          <span className="cc-icon-tile w-10 h-10">
            <Route className="w-5 h-5" />
          </span>
          <div>
            <div className="text-sm font-semibold text-[var(--foreground)]">My Rides</div>
            <div className="text-xs text-[var(--muted)] mt-0.5">{totalTrips} completed</div>
          </div>
        </Link>
        <Link
          href="/student/profile"
          className="cc-card cc-card-hover rounded-2xl p-4 flex flex-col gap-2.5"
        >
          <span className="cc-icon-tile w-10 h-10">
            <User className="w-5 h-5" />
          </span>
          <div>
            <div className="text-sm font-semibold text-[var(--foreground)]">Profile</div>
            <div className="text-xs text-[var(--muted)] mt-0.5">Account &amp; details</div>
          </div>
        </Link>
        <SOSButton />
      </div>

      {/* Active Ride with Live Tracker */}
      {activeTrip ? (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-[var(--foreground)] mb-2 uppercase tracking-wide">Current Ride</h2>
          <ActiveRideTracker initialTrip={activeTrip as unknown as React.ComponentProps<typeof ActiveRideTracker>['initialTrip']} />
        </div>
      ) : (
        <div className="mb-6 cc-card rounded-2xl p-6 text-center">
          <p className="text-sm text-[var(--muted)]">No active ride right now.</p>
          <Link href="/student/book" className="inline-block mt-2 text-sm font-medium text-[var(--primary)] hover:underline">
            Book a ride →
          </Link>
        </div>
      )}

      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-[var(--foreground)] mb-2 uppercase tracking-wide">Notifications</h2>
          <div className="cc-card rounded-2xl divide-y divide-[var(--border-color)] overflow-hidden">
            {notifications.map((n) => (
              <div key={n.id} className="p-4 flex items-start gap-3">
                <span className="cc-icon-tile w-8 h-8 shrink-0 rounded-full">
                  <Bell className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--foreground)]">{n.title}</p>
                  <p className="text-xs text-[var(--muted)] mt-0.5">{n.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Trips */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-[var(--foreground)] uppercase tracking-wide">Recent Trips</h2>
          <Link href="/student/rides" className="text-xs font-medium text-[var(--primary)] hover:underline">View all</Link>
        </div>
        {recentTrips.length > 0 ? (
          <div className="cc-card rounded-2xl divide-y divide-[var(--border-color)] overflow-hidden">
            {recentTrips.map((trip) => (
              <div key={trip.id} className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="cc-icon-tile w-9 h-9 shrink-0 rounded-full">
                    <Navigation className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--foreground)] truncate">
                      {trip.pickupLocation.name} → {trip.dropoffLocation.name}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {trip.passengerCount} passenger{trip.passengerCount > 1 ? 's' : ''} · {new Date(trip.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <span className="text-sm font-bold text-[var(--foreground)] whitespace-nowrap">
                  ₦{trip.totalFare.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="cc-card rounded-2xl p-6 text-center">
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
