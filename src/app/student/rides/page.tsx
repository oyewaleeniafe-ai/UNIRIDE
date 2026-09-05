import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { submitRating } from '@/lib/actions/misc';
import Link from 'next/link';
import ActiveRideTracker from '@/components/active-ride-tracker';

export default async function StudentRidesPage() {
  const session = await auth();
  const userId = (session?.user as { id: string })?.id;

  const student = await prisma.student.findUnique({ where: { userId } });
  const studentId = student?.id;

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

  const completedTrips = await prisma.trip.findMany({
    where: { studentId: studentId || '__none__', status: 'COMPLETED' },
    include: {
      pickupLocation: true,
      dropoffLocation: true,
      driver: { include: { user: true } },
      ratings: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  const cancelledTrips = await prisma.trip.findMany({
    where: { studentId: studentId || '__none__', status: 'CANCELLED' },
    include: {
      pickupLocation: true,
      dropoffLocation: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  const statusColors: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    ACCEPTED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    IN_PROGRESS: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    COMPLETED: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-[var(--foreground)] mb-1">My Rides</h1>
      <p className="text-sm text-[var(--muted)] mb-6">View your ride history and active trips</p>

      {/* Active Ride with Live Tracker */}
      {activeTrip && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-[var(--foreground)] mb-2 uppercase tracking-wide">Active Ride</h2>
          <ActiveRideTracker initialTrip={activeTrip as unknown as React.ComponentProps<typeof ActiveRideTracker>['initialTrip']} />
        </div>
      )}

      {/* Completed Trips */}
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
                  <span className="text-xs text-[var(--muted)]">
                    {new Date(trip.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                  <span>{trip.passengerCount} pax · {trip.driver?.user?.name || 'N/A'}</span>
                  <span className="font-medium text-[var(--foreground)]">₦{trip.totalFare.toLocaleString()}</span>
                </div>
                {trip.ratings.length === 0 && (
                  <form action={async (formData: FormData) => {
                    'use server';
                    const score = parseInt(formData.get('score') as string);
                    await submitRating({ tripId: trip.id, score });
                  }} className="mt-2 pt-2 border-t border-[var(--border)]">
                    <div className="flex items-center gap-2">
                      <select name="score" className="text-xs border border-[var(--border)] rounded px-2 py-1 bg-[var(--background)] text-[var(--foreground)]">
                        <option value="1">1 star</option>
                        <option value="2">2 stars</option>
                        <option value="3">3 stars</option>
                        <option value="4">4 stars</option>
                        <option value="5">5 stars</option>
                      </select>
                      <button type="submit" className="text-xs text-[var(--primary)] hover:underline">Rate</button>
                    </div>
                  </form>
                )}
                {trip.ratings.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-[var(--border)]">
                    <span className="text-xs text-[var(--muted)]">
                      Your rating: {'★'.repeat(trip.ratings[0].score)}{'☆'.repeat(5 - trip.ratings[0].score)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 text-center">
            <p className="text-sm text-[var(--muted)]">No completed trips yet.</p>
            <Link href="/student/book" className="inline-block mt-2 text-sm text-[var(--primary)] hover:underline">Book a ride →</Link>
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
                  <span className="text-xs text-[var(--muted)]">
                    {new Date(trip.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
