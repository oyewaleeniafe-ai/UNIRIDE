'use client';

import { useState } from 'react';
import Link from 'next/link';
import { forgotPasswordIdentify, forgotPasswordVerify, forgotPasswordReset } from '@/lib/actions/auth';
import { validateHintAnswer } from '@/lib/validations';
import PasswordInput from '@/components/password-input';

type Step = 'identify' | 'answer' | 'reset';

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>('identify');
  const [email, setEmail] = useState('');
  const [hintQuestion, setHintQuestion] = useState('');
  const [hintAnswer, setHintAnswer] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [expiresIn, setExpiresIn] = useState(0);
  const [showHints, setShowHints] = useState(false);
  const [hintAnswerError, setHintAnswerError] = useState('');
  const [hintAnswerTouched, setHintAnswerTouched] = useState(false);

  const PREDEFINED_QUESTIONS = [
    'What is your favorite food?',
    "What is your mother's maiden name?",
    'What city were you born in?',
    'What was the name of your first pet?',
    'What is the name of your best friend?',
    'What was the make of your first car?',
  ];

  // Step 1: Look up account and get hint question
  const handleIdentify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await forgotPasswordIdentify({ email });
      if (result.error) {
        setError(result.error);
        return;
      }
      setHintQuestion(result.hintQuestion || '');
      setStep('answer');
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify hint answer
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate hint answer before submit
    const hintErr = validateHintAnswer(hintQuestion, hintAnswer);
    if (hintErr) {
      setHintAnswerError(hintErr);
      setHintAnswerTouched(true);
      return;
    }

    setLoading(true);

    try {
      const result = await forgotPasswordVerify({ email, hintAnswer });
      if (result.error) {
        setError(result.error);
        return;
      }
      setResetToken(result.resetToken || '');
      setExpiresIn(result.expiresInSeconds || 600);
      setStep('reset');
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Set new password
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await forgotPasswordReset({ resetToken, password, confirmPassword });
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

  const stepLabels = { identify: 'Find Account', answer: 'Verify Identity', reset: 'New Password' };
  const stepNumbers = { identify: 1, answer: 2, reset: 3 };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)] px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Campus Cab</h1>
          <p className="text-sm text-[var(--muted)] mt-1">University Transportation</p>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
          {/* Step indicators */}
          <div className="flex items-center justify-center gap-2 mb-4">
            {(['identify', 'answer', 'reset'] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                  step === s
                    ? 'bg-[var(--primary)] text-[var(--primary-text)]'
                    : stepNumbers[s] < stepNumbers[step]
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                    : 'bg-[var(--background)] text-[var(--muted)] border border-[var(--border)]'
                }`}>
                  {stepNumbers[s] < stepNumbers[step] ? '✓' : stepNumbers[s]}
                </div>
                {i < 2 && <div className="w-8 h-px bg-[var(--border)]" />}
              </div>
            ))}
          </div>

          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-1">
            {stepLabels[step]}
          </h2>
          <p className="text-sm text-[var(--muted)] mb-4">
            {step === 'identify' && 'Enter your email to find your account.'}
            {step === 'answer' && `Answer your security question to verify your identity.`}
            {step === 'reset' && `Create a new password for your account. You have ${expiresIn} seconds.`}
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {success ? (
            <div className="space-y-4">
              <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded text-sm text-green-700 dark:text-green-400">
                <p className="font-medium mb-1">Password reset successful!</p>
                <p>{success}</p>
              </div>
              <Link
                href="/login"
                className="block w-full py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-md font-medium text-sm text-center hover:bg-[var(--primary-hover)] transition-colors"
              >
                Go to Sign in
              </Link>
            </div>
          ) : (
            <>
              {/* Step 1: Identify account */}
              {step === 'identify' && (
                <form onSubmit={handleIdentify} className="space-y-4">
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-[var(--foreground)] mb-1">
                      Email Address
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
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-md font-medium text-sm hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors"
                  >
                    {loading ? 'Looking up account...' : 'Continue'}
                  </button>
                </form>
              )}

              {/* Step 2: Answer hint question */}
              {step === 'answer' && (
                <form onSubmit={handleVerify} className="space-y-4">
                  <div className="p-3 bg-[var(--background)] border border-[var(--border)] rounded-md">
                    <p className="text-xs text-[var(--muted)] mb-1">Your security question:</p>
                    <p className="text-sm font-medium text-[var(--foreground)]">{hintQuestion}</p>
                  </div>
                  <div>
                    <label htmlFor="hintAnswer" className="block text-sm font-medium text-[var(--foreground)] mb-1">
                      Your Answer
                    </label>
                    <input
                      id="hintAnswer"
                      type="text"
                      value={hintAnswer}
                      onChange={(e) => {
                        setHintAnswer(e.target.value);
                        if (hintAnswerTouched) {
                          setHintAnswerError(validateHintAnswer(hintQuestion, e.target.value) || '');
                        }
                      }}
                      onBlur={() => {
                        setHintAnswerTouched(true);
                        setHintAnswerError(validateHintAnswer(hintQuestion, hintAnswer) || '');
                      }}
                      required
                      className={`w-full px-3 py-2 border rounded-md bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent ${
                        hintAnswerError ? 'border-red-400 dark:border-red-500' : 'border-[var(--border)]'
                      }`}
                      placeholder="Type your answer"
                    />
                    {hintAnswerError && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{hintAnswerError}</p>
                    )}
                  </div>

                  {/* Collapsible hints section */}
                  <div className="border border-[var(--border)] rounded-md overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowHints(!showHints)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-[var(--muted)] hover:bg-[var(--background)] transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>
                        Can&apos;t remember your question?
                      </span>
                      <svg className={`w-4 h-4 transition-transform ${showHints ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {showHints && (
                      <div className="px-3 pb-3 pt-1 border-t border-[var(--border)]">
                        <p className="text-xs text-[var(--muted)] mb-2">These are the security questions available during registration. Your question should match one of these:</p>
                        <ul className="space-y-1.5">
                          {PREDEFINED_QUESTIONS.map((q) => (
                            <li key={q} className="flex items-start gap-2 text-xs">
                              <span className="mt-1 w-1.5 h-1.5 rounded-full bg-[var(--primary)] opacity-60 shrink-0" />
                              <span className="text-[var(--foreground)]">{q}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 bg-[var(--primary)] text-[var(--primary-text)] rounded-md font-medium text-sm hover:bg-[var(--primary-hover)] disabled:opacity-50 transition-colors"
                  >
                    {loading ? 'Verifying...' : 'Verify Answer'}
                  </button>
                </form>
              )}

              {/* Step 3: Reset password */}
              {step === 'reset' && (
                <form onSubmit={handleReset} className="space-y-4">
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
            </>
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
