'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useTheme } from '@/components/theme-provider';

interface NavLink {
  href: string;
  label: string;
  icon: string;
}

const studentLinks: NavLink[] = [
  { href: '/student/dashboard', label: 'Dashboard', icon: '⊞' },
  { href: '/student/book', label: 'Book Ride', icon: '⊕' },
  { href: '/student/rides', label: 'My Rides', icon: '◈' },
  { href: '/student/profile', label: 'Profile', icon: '☺' },
];

const driverLinks: NavLink[] = [
  { href: '/driver/dashboard', label: 'Dashboard', icon: '⊞' },
  { href: '/driver/rides', label: 'Rides', icon: '◈' },
  { href: '/driver/inspection', label: 'Inspection', icon: '✓' },
  { href: '/driver/earnings', label: 'Earnings', icon: '₦' },
  { href: '/driver/profile', label: 'Profile', icon: '☺' },
];

export default function Navigation({ role }: { role: string }) {
  const pathname = usePathname();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const links = role === 'STUDENT' ? studentLinks : driverLinks;
  const basePath = role === 'STUDENT' ? '/student' : '/driver';

  return (
    <>
      {/* Top navigation bar — visible on all screens */}
      <header className="fixed top-0 left-0 right-0 h-12 bg-[var(--surface)] border-b border-[var(--border)] z-50 flex items-center justify-between px-4 lg:pl-56">
        <h1 className="text-sm font-bold text-[var(--foreground)] lg:hidden">Campus Cab</h1>
        <div className="hidden lg:block" />
        <div className="flex items-center gap-3">
          <button
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors font-medium"
            aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <span className="text-base">{resolvedTheme === 'dark' ? '☀' : '☾'}</span>
            <span className="hidden sm:inline">{resolvedTheme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--border)] text-sm text-[var(--danger)] hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors font-medium"
          >
            <span className="text-base">⏻</span>
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-56 bg-[var(--surface)] border-r border-[var(--border)] h-screen sticky top-0 pt-12">
        <div className="px-4 py-4 border-b border-[var(--border)]">
          <h1 className="text-sm font-bold text-[var(--foreground)]">Campus Cab</h1>
          <p className="text-xs text-[var(--muted)] mt-0.5">{role === 'STUDENT' ? 'Passenger Portal' : 'Driver Portal'}</p>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {links.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors ${
                  isActive
                    ? 'bg-[var(--primary)] bg-opacity-10 text-[var(--primary)] font-medium'
                    : 'text-[var(--muted-foreground)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]'
                }`}
              >
                <span className="w-5 text-center text-xs">{link.icon}</span>
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-2 py-3 border-t border-[var(--border)]">
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="flex items-center gap-2.5 px-3 py-2 rounded text-sm text-[var(--danger)] hover:bg-red-50 dark:hover:bg-red-900/20 w-full text-left"
          >
            <span className="w-5 text-center text-xs">⏻</span>
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-[var(--surface)] border-t border-[var(--border)] z-50 safe-bottom">
        <div className="flex justify-around items-center h-14">
          {links.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex flex-col items-center gap-0.5 px-2 py-1 min-w-0 ${
                  isActive ? 'text-[var(--primary)]' : 'text-[var(--muted)]'
                }`}
              >
                <span className="text-base">{link.icon}</span>
                <span className="text-[10px] font-medium truncate">{link.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
