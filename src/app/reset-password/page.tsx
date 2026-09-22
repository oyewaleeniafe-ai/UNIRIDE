'use client';

import Link from 'next/link';

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)] px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Campus Cab</h1>
          <p className="text-sm text-[var(--muted)] mt-1">University Transportation</p>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 text-center">
          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-2">Password Recovery</h2>
          <p className="text-sm text-[var(--muted)] mb-4">
            Use the forgot password flow to reset your password securely.
          </p>
          <Link
            href="/forgot-password"
            className="inline-block w-full py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-md font-medium text-sm text-center hover:bg-[var(--primary-hover)] transition-colors"
          >
            Recover Password
          </Link>
          <div className="mt-4 text-sm text-[var(--muted)]">
            <Link href="/login" className="text-[var(--primary)] hover:underline">
              ← Back to Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
