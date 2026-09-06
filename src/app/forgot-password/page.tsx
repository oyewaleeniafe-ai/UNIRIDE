'use client';

import { useState } from 'react';
import Link from 'next/link';
import { requestPasswordReset } from '@/lib/actions/auth';

export default function ForgotPasswordPage() {
  const [contact, setContact] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const result = await requestPasswordReset({ contact });
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess(result.message || 'If an account exists, a reset link has been sent.');
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
          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-2">Forgot your password?</h2>
          <p className="text-sm text-[var(--muted)] mb-4">
            Enter your email address and we&apos;ll send you a link to reset your password.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {success ? (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded text-sm text-green-700 dark:text-green-400">
                <p className="font-medium mb-1">Check your inbox!</p>
                <p>{success}</p>
                <p className="mt-2 text-green-600 dark:text-green-300 text-xs">The link expires in 60 minutes. Check your spam folder if you don&apos;t see it.</p>
              </div>
              <button
                onClick={() => { setSuccess(''); setContact(''); }}
                className="w-full py-2.5 border border-[var(--border)] rounded-md text-[var(--foreground)] font-medium text-sm hover:bg-[var(--surface-hover)] transition-colors"
              >
                Send another link
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="contact" className="block text-sm font-medium text-[var(--foreground)] mb-1">
                  Email Address
                </label>
                <input
                  id="contact"
                  type="email"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-md bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                  placeholder="you@university.edu"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-md font-medium text-sm hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors"
              >
                {loading ? 'Sending reset link...' : 'Send Reset Link'}
              </button>
            </form>
          )}

          <div className="mt-6 text-center text-sm text-[var(--muted)]">
            <Link href="/login" className="text-[var(--primary)] hover:underline">
              ← Back to Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
