'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Incorrect email or password. Please check your credentials and try again.');
        return;
      }

      // Fetch session to get role
      const res = await fetch('/api/auth/session');
      const session = await res.json();
      const role = session?.user?.role;

      if (role === 'STUDENT') {
        router.push('/student/dashboard');
      } else if (role === 'DRIVER') {
        router.push('/driver/dashboard');
      } else {
        router.push('/');
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)] px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Campus Cab & Shuttle</h1>
          <p className="text-sm text-[var(--muted)] mt-1">RideBook — University Transportation</p>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">Sign in to your account</h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[var(--foreground)] mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2 border border-[var(--border)] rounded-md bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                placeholder="you@university.edu"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-[var(--foreground)] mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-3 py-2 border border-[var(--border)] rounded-md bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                placeholder="Enter your password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-md font-medium text-sm hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-[var(--muted)]">
            <p className="mb-2">Don&apos;t have an account?</p>
            <div className="flex gap-3 justify-center">
              <Link
                href="/register/student"
                className="px-4 py-2 border border-[var(--border)] rounded-md text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors text-sm"
              >
                Register as Student
              </Link>
              <Link
                href="/register/driver"
                className="px-4 py-2 border border-[var(--border)] rounded-md text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors text-sm"
              >
                Register as Driver
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
