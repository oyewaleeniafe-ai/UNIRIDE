import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Navigation from '@/components/navigation';
import Footer from '@/components/footer';

/**
 * Admin shell.
 *
 * Only ADMIN accounts may render anything under /admin. The check is
 * server-side (session role), so a hidden link is never the only guard.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  const role = (session.user as { role: string }).role;
  if (role !== 'ADMIN') {
    redirect(role === 'DRIVER' ? '/driver/dashboard' : '/student/dashboard');
  }

  return (
    <div className="flex min-h-screen">
      <Navigation role="ADMIN" />
      <main className="flex-1 pt-14 pb-28 lg:pb-0 flex flex-col">
        <div className="flex-1">{children}</div>
        <Footer />
      </main>
    </div>
  );
}
