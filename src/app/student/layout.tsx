import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Navigation from '@/components/navigation';

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  const role = (session.user as { role: string }).role;
  if (role !== 'STUDENT') {
    redirect('/driver/dashboard');
  }

  return (
    <div className="flex min-h-screen">
      <Navigation role="STUDENT" />
      <main className="flex-1 lg:ml-0 pb-16 lg:pb-0">
        {children}
      </main>
    </div>
  );
}
