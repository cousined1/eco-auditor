import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { insforge, isInsForgeConfigured } from '../lib/insforge';
import {
  AuthError,
  AuthHeading,
  AuthShell,
  ConfigWarning,
  SubmitLabel,
} from '../components/auth/AuthShell';
import { authInputClass, useNoIndex } from '../components/auth/authHelpers';
import { PasswordInput } from '../components/auth/PasswordInput';

// Matches the signup form. Note the backend's own minimum is lower
// (auth.password.min_length = 6 in insforge.toml); the stricter client rule is
// deliberate, so a reset cannot weaken an account below what signup requires.
const PASSWORD_MIN_LENGTH = 8;
const isPasswordValid = (value: string) =>
  value.length >= PASSWORD_MIN_LENGTH && /[a-zA-Z]/.test(value) && /\d/.test(value);

/**
 * Password reset, in the emailed-code form.
 *
 * The project runs with `reset_password_method = "code"`, so there is no magic
 * link to land on: the user gets a code, exchanges it for a one-time token,
 * and sets the new password. Keeping both steps on one page means no redirect
 * URL to allowlist and nothing to lose between pages.
 */
export default function ForgotPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const loginHref = `/login${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useNoIndex();

  const mismatch = confirm.length > 0 && password !== confirm;

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { error: sendError } = await insforge.auth.sendResetPasswordEmail({ email: email.trim() });

      // Deliberately not surfacing "no such account" — that would turn this
      // form into an account-existence oracle. Advance either way.
      if (sendError && sendError.statusCode !== 404) {
        setError(sendError.message || 'Could not send the reset email. Please try again.');
        return;
      }
      setStep('reset');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reset email. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isPasswordValid(password)) {
      setError('Password must be at least 8 characters and include at least one letter and one number.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      // The code is exchanged for a single-use token, which is what actually
      // authorises the password change.
      const { data, error: exchangeError } = await insforge.auth.exchangeResetPasswordToken({
        email: email.trim(),
        code: code.trim(),
      });

      if (exchangeError || !data?.token) {
        setError(exchangeError?.message || 'That code is not valid or has expired. Request a new one.');
        return;
      }

      const { error: resetError } = await insforge.auth.resetPassword({
        newPassword: password,
        otp: data.token,
      });

      if (resetError) {
        setError(resetError.message || 'Could not set the new password. Please try again.');
        return;
      }

      // Send them to sign in rather than assuming a session — the reset
      // endpoint's job is the password, not establishing a login.
      navigate(loginHref, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset your password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'reset') {
    return (
      <AuthShell>
        {/* Reaching this step without an email is legitimate — the user may be
            arriving in a new tab with a code in hand, and the form asks for the
            address separately. It is NOT legitimate to leave an empty address in
            the subtitle: it rendered "If an account exists for , we've emailed a
            reset code." on exactly that path, which is the path the "I already
            have a code" button exists to serve. */}
        <AuthHeading
          title="Enter your code"
          subtitle={
            email.trim()
              ? `If an account exists for ${email.trim()}, we've emailed a reset code. Enter it below with your new password.`
              : "Enter your new password below, along with the 6-digit code we emailed you."
          }
        />

        <div className="card space-y-3">
          <form onSubmit={(e) => void handleReset(e)} className="space-y-3">
            {/* The email is required to exchange the code, but a user who
                arrives via "I already have a code" (new tab, or after closing
                the page) has no `email` in state. Without this field the
                exchange was called with an empty email and always failed with
                "That code is not valid or has expired" -- for a valid code. */}
            <div>
              <label htmlFor="reset-step-email" className="sr-only">Email address</label>
              <input
                id="reset-step-email"
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
            <div>
              <label htmlFor="reset-code" className="sr-only">Reset code</label>
              <input
                id="reset-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                placeholder="Reset code from your email"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={submitting}
                className={authInputClass}
              />
            </div>
            <PasswordInput
              id="new-password"
              label="New password"
              placeholder="New password (8+ characters, with a letter and a number)"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              value={password}
              onChange={setPassword}
              disabled={submitting}
            />
            <PasswordInput
              id="confirm-password"
              label="Confirm new password"
              placeholder="Confirm new password"
              autoComplete="new-password"
              value={confirm}
              onChange={setConfirm}
              disabled={submitting}
              invalid={mismatch}
              {...(mismatch ? { errorId: 'confirm-password-error' } : {})}
            >
              {mismatch && (
                <p id="confirm-password-error" className="text-xs text-risk-high mt-1" role="alert">
                  The two passwords do not match.
                </p>
              )}
            </PasswordInput>
            <button
              type="submit"
              disabled={submitting || !email.trim() || !code.trim() || !isPasswordValid(password) || password !== confirm}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <SubmitLabel submitting={submitting} idle="Set new password" busy="Saving…" />
            </button>
          </form>

          <AuthError message={error} />

          <button
            type="button"
            onClick={() => { setStep('request'); setError(null); setCode(''); setPassword(''); setConfirm(''); }}
            className="w-full text-center text-xs text-accent-text hover:underline"
          >
            Use a different email, or send another code
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthHeading
        title="Reset your password"
        subtitle="Enter the email you signed up with and we'll send you a code to set a new password."
      />

      <div className="card space-y-3">
        <ConfigWarning action="password reset" />

        <form onSubmit={(e) => void handleRequest(e)} className="space-y-3">
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
            <SubmitLabel submitting={submitting} idle="Send reset code" busy="Sending…" />
          </button>
        </form>

        <AuthError message={error} />

        <button
          type="button"
          onClick={() => { setStep('reset'); setError(null); }}
          className="w-full text-center text-xs text-accent-text hover:underline"
        >
          I already have a code
        </button>
      </div>

      <p className="mt-6 text-center text-sm text-surface-500">
        Remembered it?{' '}
        <Link to={loginHref} className="font-medium text-accent-text hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
