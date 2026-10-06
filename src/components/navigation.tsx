'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useTheme } from '@/components/theme-provider';
import {
  LayoutGrid,
  CarFront,
  Route,
  User,
  ClipboardList,
  ShieldCheck,
  Banknote,
  Sun,
  Moon,
  LogOut,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

const studentLinks: NavLink[] = [
  { href: '/student/dashboard', label: 'Home', icon: LayoutGrid },
  { href: '/student/book', label: 'Book Ride', icon: CarFront },
  { href: '/student/rides', label: 'My Rides', icon: Route },
  { href: '/student/profile', label: 'Profile', icon: User },
];

const driverLinks: NavLink[] = [
  { href: '/driver/dashboard', label: 'Home', icon: LayoutGrid },
  { href: '/driver/rides', label: 'Rides', icon: ClipboardList },
  { href: '/driver/inspection', label: 'Inspection', icon: ShieldCheck },
  { href: '/driver/earnings', label: 'Earnings', icon: Banknote },
  { href: '/driver/profile', label: 'Profile', icon: User },
];

function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[var(--primary)] text-[var(--primary-text)] ${className}`}
      aria-hidden
    >
      <CarFront className="w-4 h-4" strokeWidth={2.4} />
    </span>
  );
}

export default function Navigation({ role }: { role: string }) {
  const pathname = usePathname();
  const { setTheme, resolvedTheme } = useTheme();
  const links = role === 'STUDENT' ? studentLinks : driverLinks;
  const basePath = role === 'STUDENT' ? '/student' : '/driver';

  const toggleTheme = () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');

  return (
    <>
      {/* Top bar — brand + theme + sign out, on all screens */}
      <header className="fixed top-0 left-0 right-0 h-14 bg-[var(--surface)]/90 backdrop-blur-md border-b border-[var(--border-color)] z-50 flex items-center justify-between px-4 lg:pl-64 lg:pr-6">
        <Link href={`${basePath}/dashboard`} className="flex items-center gap-2">
          <BrandMark />
          <span className="text-[15px] font-bold tracking-tight text-[var(--foreground)]">
            CampusCab
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center w-9 h-9 rounded-full text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] transition-colors"
            aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {resolvedTheme === 'dark' ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
          </button>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex items-center gap-1.5 h-9 px-3 rounded-full text-[13px] font-medium text-[var(--muted)] hover:text-[var(--danger)] hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-60 bg-[var(--surface)] border-r border-[var(--border-color)] h-screen sticky top-0 pt-14 px-3 pb-4">
        <div className="px-3 pt-4 pb-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-fg)]">
            {role === 'STUDENT' ? 'Passenger Portal' : 'Driver Portal'}
          </p>
        </div>

        <nav className="flex-1 space-y-1">
          {links.map((link) => {
            const Icon = link.icon;
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                    : 'text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]'
                }`}
              >
                <Icon className="w-[18px] h-[18px]" strokeWidth={isActive ? 2.4 : 2} />
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="pt-3 border-t border-[var(--border-color)]">
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-[var(--muted)] hover:text-[var(--danger)] hover:bg-red-50 dark:hover:bg-red-900/20 w-full text-left transition-colors"
          >
            <LogOut className="w-[18px] h-[18px]" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile — floating rounded bottom navigation */}
      <nav
        className="lg:hidden fixed bottom-3 left-4 right-4 z-50"
        aria-label="Primary"
      >
        <div className="safe-bottom">
          <div className="flex justify-around items-center h-16 bg-[var(--surface)]/95 backdrop-blur-md border border-[var(--border-color)] rounded-2xl shadow-[var(--shadow-lg)] px-1.5">
            {links.map((link) => {
              const Icon = link.icon;
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 min-w-0 rounded-full transition-colors ${
                    isActive
                      ? 'bg-[var(--primary)] text-[var(--primary-text)] shadow-[var(--shadow-md)]'
                      : 'text-[var(--muted)] active:bg-[var(--surface-hover)]'
                  }`}
                >
                  <Icon className="w-5 h-5" strokeWidth={isActive ? 2.4 : 2} />
                  <span className="text-[10px] font-semibold truncate">{link.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
}
