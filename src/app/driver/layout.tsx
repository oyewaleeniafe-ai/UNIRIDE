import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Navigation from '@/components/navigation';
import Footer from '@/components/footer';

export default async function DriverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  const role = (session.user as { role: string }).role;
  if (role !== 'DRIVER') {
    redirect('/student/dashboard');
  }

  return (
    <div className="flex min-h-screen">
      <Navigation role="DRIVER" />
      <main className="flex-1 pt-14 pb-28 lg:pb-0 flex flex-col">
        <div className="flex-1">{children}</div>
        <Footer />
      </main>
    </div>
  );
}
