import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export default async function DriverEarningsPage() {
  const session = await auth();
  const userId = (session?.user as { id: string })?.id;

  const driver = await prisma.driver.findUnique({ where: { userId } });

  const completedTrips = driver
    ? await prisma.trip.findMany({
        where: { driverId: driver.id, status: 'COMPLETED' },
        include: {
          pickupLocation: true,
          dropoffLocation: true,
          student: { include: { user: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
    : [];

  const totalEarnings = completedTrips.reduce((sum, t) => sum + t.totalFare, 0);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayEarnings = completedTrips
    .filter((t) => new Date(t.createdAt) >= todayStart)
    .reduce((sum, t) => sum + t.totalFare, 0);

  const todayTrips = completedTrips.filter((t) => new Date(t.createdAt) >= todayStart).length;

  // Weekly breakdown
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const weeklyEarnings = completedTrips
    .filter((t) => new Date(t.createdAt) >= weekStart)
    .reduce((sum, t) => sum + t.totalFare, 0);

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-[var(--foreground)] mb-1">Earnings</h1>
      <p className="text-sm text-[var(--muted)] mb-6">Your ride earnings overview</p>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 text-center">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wide">Today</p>
          <p className="text-xl font-bold text-[var(--foreground)] mt-1">₦{todayEarnings.toLocaleString()}</p>
          <p className="text-xs text-[var(--muted)] mt-0.5">{todayTrips} rides</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 text-center">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wide">This Week</p>
          <p className="text-xl font-bold text-[var(--foreground)] mt-1">₦{weeklyEarnings.toLocaleString()}</p>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 text-center">
          <p className="text-xs text-[var(--muted)] uppercase tracking-wide">All Time</p>
          <p className="text-xl font-bold text-[var(--foreground)] mt-1">₦{totalEarnings.toLocaleString()}</p>
          <p className="text-xs text-[var(--muted)] mt-0.5">{completedTrips.length} rides</p>
        </div>
      </div>

      {/* Earnings History */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--foreground)] mb-2 uppercase tracking-wide">Earnings History</h2>
        {completedTrips.length > 0 ? (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                  <th className="text-left px-4 py-2 font-medium text-xs">Date</th>
                  <th className="text-left px-4 py-2 font-medium text-xs">Route</th>
                  <th className="text-left px-4 py-2 font-medium text-xs hidden sm:table-cell">Passenger</th>
                  <th className="text-right px-4 py-2 font-medium text-xs">Earnings</th>
                </tr>
              </thead>
              <tbody>
                {completedTrips.map((trip) => (
                  <tr key={trip.id} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="px-4 py-2 text-[var(--muted)]">
                      {new Date(trip.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-[var(--foreground)]">
                      {trip.pickupLocation.name} → {trip.dropoffLocation.name}
                    </td>
                    <td className="px-4 py-2 text-[var(--muted)] hidden sm:table-cell">
                      {trip.student.user.name}
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-[var(--foreground)]">
                      ₦{trip.totalFare.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 text-center">
            <p className="text-sm text-[var(--muted)]">No earnings yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
