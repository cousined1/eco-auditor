import { useState } from 'react';
import { Link } from 'react-router-dom';
import { insforge, isInsForgeConfigured } from '../lib/insforge';
import {
  AuthError,
  AuthHeading,
  AuthShell,
  ConfigWarning,
  SubmitLabel,
} from '../components/auth/AuthShell';
import { authInputClass, useNoIndex } from '../components/auth/authHelpers';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useNoIndex();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { error: resetError } = await insforge.auth.sendResetPasswordEmail({
        email: email.trim(),
        redirectTo: `${window.location.origin}/reset-password`,
      });

      // Deliberately not surfacing "no such account": that turns this form into
      // an account-existence oracle. Always show the same confirmation.
      if (resetError && resetError.statusCode !== 404) {
        setError(resetError.message || 'Could not send the reset email. Please try again.');
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reset email. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthShell centered>
        <div className="card">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
            <svg className="h-6 w-6 text-accent" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-surface-900 dark:text-white">Check your email</h1>
          <p className="mt-2 text-sm text-surface-500">
            If an account exists for{' '}
            <span className="font-medium text-surface-700 dark:text-surface-300">{email}</span>, we've sent a
            link to reset your password. The link expires shortly, so use it soon.
          </p>
          <Link to="/login" className="btn-primary mt-6 inline-flex">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthHeading
        title="Reset your password"
        subtitle="Enter the email you signed up with and we'll send you a link to set a new password."
      />

      <div className="card space-y-3">
        <ConfigWarning action="password reset" />

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <div>
            <label htmlFor="reset-email" className="sr-only">Email address</label>
            <input
              id="reset-email"
              type="email"
              autoComplete="email"
              required
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              className={authInputClass}
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !email.trim() || !isInsForgeConfigured}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <SubmitLabel submitting={submitting} idle="Send reset link" busy="Sending…" />
          </button>
        </form>

        <AuthError message={error} />
      </div>

      <p className="mt-6 text-center text-sm text-surface-500">
        Remembered it?{' '}
        <Link to="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
