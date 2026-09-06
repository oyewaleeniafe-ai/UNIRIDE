'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { resetPassword } from '@/lib/actions/auth';
import PasswordInput from '@/components/password-input';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const prefillToken = searchParams.get('token') || '';

  const [token, setToken] = useState(prefillToken);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const result = await resetPassword({ token, password, confirmPassword });
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess(result.message || 'Password reset successfully. You can now sign in.');
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
      <h2 className="text-lg font-semibold text-[var(--foreground)] mb-2">Reset your password</h2>
      <p className="text-sm text-[var(--muted)] mb-4">
        Paste the reset code from your email or phone, then choose a new password.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 space-y-3">
          <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded text-sm text-green-700 dark:text-green-400">
            {success}
          </div>
          <Link
            href="/login"
            className="block w-full py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-md font-medium text-sm text-center hover:bg-[var(--primary-hover)] transition-colors"
          >
            Go to Sign in
          </Link>
        </div>
      )}

      {!success && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="token" className="block text-sm font-medium text-[var(--foreground)] mb-1">
              Reset Code
            </label>
            <input
              id="token"
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              className="w-full px-3 py-2 border border-[var(--border)] rounded-md bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent font-mono"
              placeholder="Paste your reset code here"
            />
          </div>

          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-[var(--foreground)] mb-1">
              New Password
            </label>
            <PasswordInput
              id="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-sm font-medium text-[var(--foreground)] mb-1">
              Confirm New Password
            </label>
            <PasswordInput
              id="confirm-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              placeholder="Repeat your new password"
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-md font-medium text-sm hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors"
          >
            {loading ? 'Resetting password...' : 'Reset Password'}
          </button>
        </form>
      )}

      <div className="mt-6 text-center text-sm text-[var(--muted)]">
        <Link href="/forgot-password" className="text-[var(--primary)] hover:underline">
          ← Need a new reset code?
        </Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)] px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Campus Cab & Shuttle</h1>
          <p className="text-sm text-[var(--muted)] mt-1">RideBook — University Transportation</p>
        </div>

        <Suspense
          fallback={
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 text-center text-sm text-[var(--muted)]">
              Loading...
            </div>
          }
        >
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
