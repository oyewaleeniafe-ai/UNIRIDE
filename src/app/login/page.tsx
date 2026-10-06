'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { loginUser } from '@/lib/actions/auth';
import PasswordInput from '@/components/password-input';
import BackgroundSlideshow from '@/components/background-slideshow';

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
      const result = await loginUser({ email, password });

      if (!result.success) {
        setError(result.message || 'Unable to log in. Please try again.');
        return;
      }

      // Credentials validated server-side — now establish the NextAuth session
      const signInResult = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (signInResult?.error) {
        setError('Unable to complete login. Please try again.');
        return;
      }

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
      setError('Unable to complete login. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-[var(--background)] px-4 overflow-hidden">
      {/* Decorative full-screen background slideshow (visual only) */}
      <BackgroundSlideshow
        className="absolute inset-0 z-0"
        overlayClassName="cc-login-scrim"
      />

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8 cc-text-lift">
          <h1 className="text-3xl font-bold tracking-tight text-[var(--foreground)]">CampusCab</h1>
          <p className="text-sm text-[var(--muted)] mt-1">University Transportation</p>
        </div>

        <div className="cc-card rounded-2xl shadow-[var(--shadow-lg)] p-6 sm:p-7">
          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-5">Sign in to your account</h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400">
              <p>{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 login-placeholder-hidden">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="cc-input"
                placeholder="you@university.edu"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-[var(--foreground)] mb-1">
                Password
              </label>
              <PasswordInput
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Enter your password"
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="cc-btn-primary w-full"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <Link href="/forgot-password" className="text-sm text-[var(--primary)] hover:underline">
              Forgot Password?
            </Link>
          </div>

          <div className="mt-6 text-center text-sm text-[var(--muted)]">
            <p className="mb-2">Don&apos;t have an account?</p>
            <div className="flex gap-3 justify-center">
              <Link
                href="/register/student"
                className="px-4 py-2 border border-[var(--border-color)] rounded-xl text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors text-sm font-medium"
              >
                Register as Student
              </Link>
              <Link
                href="/register/driver"
                className="px-4 py-2 border border-[var(--border-color)] rounded-xl text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors text-sm font-medium"
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
