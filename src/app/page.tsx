import type { Metadata } from 'next';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Campus Cab — University Ride-Hailing Platform',
  description:
    'Book campus cabs, shuttles, and carpools instantly. Safe, affordable transportation for university students and drivers. Track rides in real-time with SOS safety features.',
  keywords: [
    'campus cab',
    'university ride',
    'student transportation',
    'campus shuttle',
    'carpool',
    'ride hailing',
    'student ride book',
  ],
  openGraph: {
    title: 'Campus Cab — University Ride-Hailing Platform',
    description:
      'Book campus cabs, shuttles, and carpools instantly. Safe, affordable transportation for university students and drivers.',
    type: 'website',
    siteName: 'Campus Cab',
  },
};

const FEATURES = [
  {
    icon: '🚕',
    title: 'Solo Quick Cab',
    desc: 'Direct point-to-point ride. Fastest way across campus.',
  },
  {
    icon: '🚐',
    title: 'Shared Shuttle',
    desc: 'Carpool with fellow students and split the fare.',
  },
  {
    icon: '🛡️',
    title: 'SOS Safety Button',
    desc: 'One-tap emergency alert with GPS location sharing.',
  },
  {
    icon: '📍',
    title: 'Live Ride Tracking',
    desc: 'Real-time status updates from request to arrival.',
  },
  {
    icon: '💳',
    title: 'Direct Driver Payment',
    desc: 'Zero platform fees — 100% of the fare goes to the driver.',
  },
  {
    icon: '⭐',
    title: 'Rating System',
    desc: 'Rate your ride and help maintain quality drivers.',
  },
];

export default async function HomePage() {
  const session = await auth();

  if (session?.user) {
    const role = (session.user as { role: string }).role;
    if (role === 'STUDENT') {
      redirect('/student/dashboard');
    } else if (role === 'DRIVER') {
      redirect('/driver/dashboard');
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero Section */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--primary)] to-blue-700 opacity-95" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 text-center">
          <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm text-white/90 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Live on Campus
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight leading-tight">
            Campus Cab
          </h1>
          <p className="mt-3 text-lg sm:text-xl text-white/80 font-medium">
            University Ride-Hailing Platform
          </p>
          <p className="mt-4 max-w-2xl mx-auto text-white/70 text-sm sm:text-base leading-relaxed">
            Book campus cabs, shuttles, and carpools in seconds. Safe,
            affordable transportation built for students, by students.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/register/student"
              className="w-full sm:w-auto px-8 py-3.5 bg-white text-[var(--primary)] font-bold rounded-lg hover:bg-white/90 transition-colors text-sm shadow-lg"
            >
              Sign Up as Student
            </Link>
            <Link
              href="/register/driver"
              className="w-full sm:w-auto px-8 py-3.5 bg-white/15 text-white font-bold rounded-lg hover:bg-white/25 transition-colors text-sm border border-white/20"
            >
              Register as Driver
            </Link>
          </div>

          <p className="mt-5 text-white/50 text-xs">
            Already have an account?{' '}
            <Link href="/login" className="text-white/80 underline hover:text-white transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </header>

      {/* Features Section */}
      <section className="flex-1 bg-[var(--background)] py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)]">
              Why Campus Cab?
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)] max-w-lg mx-auto">
              Everything you need for safe, reliable campus transportation — in one app.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 hover:shadow-md transition-shadow"
              >
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="text-sm font-bold text-[var(--foreground)]">{f.title}</h3>
                <p className="mt-1 text-xs text-[var(--muted)] leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="bg-[var(--surface)] border-t border-[var(--border)] py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
            <div>
              <div className="text-2xl sm:text-3xl font-extrabold text-[var(--primary)]">4</div>
              <div className="text-xs text-[var(--muted)] mt-1 font-medium">Campus Locations</div>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-extrabold text-[var(--primary)]">24/7</div>
              <div className="text-xs text-[var(--muted)] mt-1 font-medium">Availability</div>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-extrabold text-[var(--primary)]">₦0</div>
              <div className="text-xs text-[var(--muted)] mt-1 font-medium">Platform Fees</div>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-extrabold text-[var(--primary)]">100%</div>
              <div className="text-xs text-[var(--muted)] mt-1 font-medium">Driver Earnings</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-[var(--background)] py-16">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--foreground)]">
            Ready to ride?
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Join your campus community and start booking rides today.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/register/student"
              className="w-full sm:w-auto px-8 py-3.5 bg-[var(--primary)] text-[var(--primary-text)] font-bold rounded-lg hover:opacity-90 transition-opacity text-sm"
            >
              Get Started — It&apos;s Free
            </Link>
            <Link
              href="/login"
              className="w-full sm:w-auto px-8 py-3.5 border border-[var(--border)] text-[var(--foreground)] font-bold rounded-lg hover:bg-[var(--surface-hover)] transition-colors text-sm"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
