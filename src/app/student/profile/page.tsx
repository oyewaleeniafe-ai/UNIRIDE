import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export default async function StudentProfilePage() {
  const session = await auth();
  const userId = (session?.user as { id: string })?.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { student: true },
  });

  const tripCount = await prisma.trip.count({ where: { studentId: userId } });
  const completedCount = await prisma.trip.count({ where: { studentId: userId, status: 'COMPLETED' } });

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-[var(--foreground)] mb-6">Profile</h1>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
        {/* Avatar */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-[var(--primary)] bg-opacity-10 flex items-center justify-center text-xl font-bold text-[var(--primary)]">
            {user?.name?.charAt(0)?.toUpperCase() || 'S'}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">{user?.name}</h2>
            <p className="text-sm text-[var(--muted)]">Student</p>
          </div>
        </div>

        {/* Info */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Full Name</label>
            <p className="text-sm text-[var(--foreground)]">{user?.name}</p>
          </div>
          <div>
            <label className="block text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Matric Number</label>
            <p className="text-sm text-[var(--foreground)]">{user?.student?.matricNo}</p>
          </div>
          <div>
            <label className="block text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Email</label>
            <p className="text-sm text-[var(--foreground)]">{user?.email}</p>
          </div>
          <div>
            <label className="block text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Phone</label>
            <p className="text-sm text-[var(--foreground)]">{user?.phone}</p>
          </div>

          <div className="pt-4 border-t border-[var(--border)]">
            <h3 className="text-sm font-medium text-[var(--foreground)] mb-3">Ride Statistics</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-[var(--background)] rounded-lg">
                <p className="text-2xl font-bold text-[var(--foreground)]">{tripCount}</p>
                <p className="text-xs text-[var(--muted)]">Total Rides</p>
              </div>
              <div className="p-3 bg-[var(--background)] rounded-lg">
                <p className="text-2xl font-bold text-[var(--foreground)]">{completedCount}</p>
                <p className="text-xs text-[var(--muted)]">Completed</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
