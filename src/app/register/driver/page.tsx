'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { registerDriver } from '@/lib/actions/auth';
import { validateHintAnswer } from '@/lib/validations';
import PasswordInput from '@/components/password-input';

export default function RegisterDriverPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    email: '',
    driverId: '',
    phone: '',
    password: '',
    confirmPassword: '',
    hintQuestion: '',
    hintAnswer: '',
    vehicleMake: '',
    vehicleModel: '',
    vehicleColor: '',
    licensePlate: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [hintAnswerError, setHintAnswerError] = useState('');
  const [hintAnswerTouched, setHintAnswerTouched] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate hint answer before submit
    const hintErr = validateHintAnswer(form.hintQuestion, form.hintAnswer);
    if (hintErr) {
      setHintAnswerError(hintErr);
      setHintAnswerTouched(true);
      return;
    }

    setLoading(true);

    try {
      const result = await registerDriver(form);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push('/login?registered=true');
    } catch {
      setError('An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === 'hintAnswer' && hintAnswerTouched) {
      setHintAnswerError(validateHintAnswer(form.hintQuestion, value) || '');
    }
  };

  const onHintAnswerBlur = () => {
    setHintAnswerTouched(true);
    setHintAnswerError(validateHintAnswer(form.hintQuestion, form.hintAnswer) || '');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)] px-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-[var(--foreground)]">Campus Cab</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Driver Registration</p>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4">Create your driver account</h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1">Full Name</label>
              <input type="text" value={form.name} onChange={(e) => updateField('name', e.target.value)} required
                className="w-full px-3 py-2 border border-[var(--border)] rounded-md bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1">Driver ID</label>
              <input type="text" value={form.driverId} onChange={(e) => updateField('driverId', e.target.value)} required
                className="w-full px-3 py-2 border border-[var(--border)] rounded-md bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1">Email</label>
              <input type="email" value={form.email} onChange={(e) => updateField('email', e.target.value)} required
                className="w-full px-3 py-2 border border-[var(--border)] rounded-md bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1">Phone Number</label>
              <input type="tel" value={form.phone} onChange={(e) => updateField('phone', e.target.value)} required
                className="w-full px-3 py-2 border border-[var(--border)] rounded-md bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1">Password</label>
              <PasswordInput value={form.password} onChange={(e) => updateField('password', e.target.value)} required minLength={8} placeholder="At least 8 characters" autoComplete="new-password" />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1">Confirm Password</label>
              <PasswordInput value={form.confirmPassword} onChange={(e) => updateField('confirmPassword', e.target.value)} required placeholder="Repeat your password" autoComplete="new-password" />
            </div>

            <div className="pt-2 border-t border-[var(--border)]">
              <p className="text-sm font-medium text-[var(--foreground)] mb-1">Password Recovery</p>
              <p className="text-xs text-[var(--muted)] mb-3">Choose a question you&apos;ll remember. This will help you reset your password if you forget it.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1">Hint Question</label>
              <select
                value={form.hintQuestion}
                onChange={(e) => updateField('hintQuestion', e.target.value)}
                required
                className="w-full px-3 py-2 border border-[var(--border)] rounded-md bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              >
                <option value="" disabled>Select a security question</option>
                <option value="What is your favorite food?">What is your favorite food?</option>
                <option value="What is your mother's maiden name?">What is your mother&apos;s maiden name?</option>
                <option value="What city were you born in?">What city were you born in?</option>
                <option value="What was the name of your first pet?">What was the name of your first pet?</option>
                <option value="What is the name of your best friend?">What is the name of your best friend?</option>
                <option value="What was the make of your first car?">What was the make of your first car?</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1">Hint Answer</label>
              <input type="text" value={form.hintAnswer} onChange={(e) => updateField('hintAnswer', e.target.value)} onBlur={onHintAnswerBlur} required
                className={`w-full px-3 py-2 border rounded-md bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] ${
                  hintAnswerError ? 'border-red-400 dark:border-red-500' : 'border-[var(--border)]'
                }`}
                placeholder="e.g. Jollof rice" />
              {hintAnswerError && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{hintAnswerError}</p>
              )}
            </div>

            <div className="pt-2 border-t border-[var(--border)]">
              <p className="text-sm font-medium text-[var(--foreground)] mb-3">Vehicle Information</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-[var(--foreground)] mb-1">Make</label>
                <input type="text" value={form.vehicleMake} onChange={(e) => updateField('vehicleMake', e.target.value)} required placeholder="Toyota"
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-md bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--foreground)] mb-1">Model</label>
                <input type="text" value={form.vehicleModel} onChange={(e) => updateField('vehicleModel', e.target.value)} required placeholder="Corolla"
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-md bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-[var(--foreground)] mb-1">Color</label>
                <input type="text" value={form.vehicleColor} onChange={(e) => updateField('vehicleColor', e.target.value)} required placeholder="Silver"
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-md bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--foreground)] mb-1">License Plate</label>
                <input type="text" value={form.licensePlate} onChange={(e) => updateField('licensePlate', e.target.value)} required placeholder="ABC-123-DE"
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-md bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]" />
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-md font-medium text-sm hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors">
              {loading ? 'Creating account...' : 'Create Driver Account'}
            </button>
          </form>

          <div className="mt-4 text-center text-sm text-[var(--muted)]">
            Already have an account?{' '}
            <Link href="/login" className="text-[var(--primary)] hover:underline">Sign in</Link>
          </div>
          <div className="text-center text-sm text-[var(--muted)] mt-1">
            Register as a{' '}
            <Link href="/register/student" className="text-[var(--primary)] hover:underline">student</Link>
            {' '}instead?
          </div>
        </div>
      </div>
    </div>
  );
}
