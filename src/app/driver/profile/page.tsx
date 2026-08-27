import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export default async function DriverProfilePage() {
  const session = await auth();
  const userId = (session?.user as { id: string })?.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      driver: {
        include: {
          vehicle: true,
        },
      },
    },
  });

  const driver = user?.driver;

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-[var(--foreground)] mb-6">Profile</h1>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-[var(--primary)] bg-opacity-10 flex items-center justify-center text-xl font-bold text-[var(--primary)]">
            {user?.name?.charAt(0)?.toUpperCase() || 'D'}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">{user?.name}</h2>
            <p className="text-sm text-[var(--muted)]">Driver</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Full Name</label>
            <p className="text-sm text-[var(--foreground)]">{user?.name}</p>
          </div>
          <div>
            <label className="block text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Driver ID</label>
            <p className="text-sm text-[var(--foreground)]">{driver?.driverId}</p>
          </div>
          <div>
            <label className="block text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Email</label>
            <p className="text-sm text-[var(--foreground)]">{user?.email}</p>
          </div>
          <div>
            <label className="block text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Phone</label>
            <p className="text-sm text-[var(--foreground)]">{user?.phone}</p>
          </div>

          {/* Vehicle Info */}
          {driver?.vehicle && (
            <div className="pt-4 border-t border-[var(--border)]">
              <h3 className="text-sm font-medium text-[var(--foreground)] mb-3">Vehicle Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-[var(--muted)] mb-1">Make & Model</label>
                  <p className="text-sm text-[var(--foreground)]">{driver.vehicle.make} {driver.vehicle.model}</p>
                </div>
                <div>
                  <label className="block text-xs text-[var(--muted)] mb-1">Color</label>
                  <p className="text-sm text-[var(--foreground)]">{driver.vehicle.color}</p>
                </div>
                <div>
                  <label className="block text-xs text-[var(--muted)] mb-1">License Plate</label>
                  <p className="text-sm text-[var(--foreground)]">{driver.vehicle.licensePlate}</p>
                </div>
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="pt-4 border-t border-[var(--border)]">
            <h3 className="text-sm font-medium text-[var(--foreground)] mb-3">Statistics</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="p-3 bg-[var(--background)] rounded-lg">
                <p className="text-2xl font-bold text-[var(--foreground)]">{driver?.totalTrips || 0}</p>
                <p className="text-xs text-[var(--muted)]">Total Rides</p>
              </div>
              <div className="p-3 bg-[var(--background)] rounded-lg">
                <p className="text-2xl font-bold text-[var(--foreground)]">{driver?.avgRating?.toFixed(1) || '—'}</p>
                <p className="text-xs text-[var(--muted)]">Avg Rating</p>
              </div>
              <div className="p-3 bg-[var(--background)] rounded-lg">
                <p className="text-2xl font-bold text-[var(--foreground)]">{driver?.isOnline ? '●' : '○'}</p>
                <p className="text-xs text-[var(--muted)]">Status</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
