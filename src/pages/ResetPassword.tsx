import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { insforge } from '../lib/insforge';
import {
  AuthError,
  AuthHeading,
  AuthShell,
  SubmitLabel,
} from '../components/auth/AuthShell';
import { authInputClass, useNoIndex } from '../components/auth/authHelpers';

// Same policy the signup form enforces.
const PASSWORD_MIN_LENGTH = 8;
const isPasswordValid = (value: string) =>
  value.length >= PASSWORD_MIN_LENGTH && /[a-zA-Z]/.test(value) && /\d/.test(value);

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // The magic-link flow redirects back with `token`, `insforge_status`, and
  // `insforge_type` query params; `token` is the one-time reset credential.
  const token = searchParams.get('token');
  const linkStatus = searchParams.get('insforge_status');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useNoIndex();

  const linkUsable = Boolean(token) && linkStatus !== 'error';
  const mismatch = confirm.length > 0 && password !== confirm;

  async function handleSubmit(e: React.FormEvent) {
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
      const { error: resetError } = await insforge.auth.resetPassword({
        newPassword: password,
        otp: token as string,
      });

      if (resetError) {
        setError(resetError.message || 'That reset link is no longer valid. Request a new one.');
        return;
      }
      // Send them to sign in rather than assuming a session: the reset
      // endpoint's job is the password, not establishing a login.
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset your password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!linkUsable) {
    return (
      <AuthShell centered>
        <div className="card">
          <h1 className="text-lg font-semibold text-surface-900 dark:text-white">This reset link isn't valid</h1>
          <p className="mt-2 text-sm text-surface-500">
            It may have expired or already been used. Request a new one and it will arrive in a moment.
          </p>
          <Link to="/forgot-password" className="btn-primary mt-6 inline-flex">
            Request a new link
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthHeading title="Choose a new password" subtitle="Pick something you haven't used here before." />

      <div className="card space-y-3">
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <div>
            <label htmlFor="new-password" className="sr-only">New password</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              placeholder="New password (8+ characters, with a letter and a number)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              className={authInputClass}
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className="sr-only">Confirm new password</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={submitting}
              aria-invalid={mismatch}
              aria-describedby={mismatch ? 'confirm-password-error' : undefined}
              className={authInputClass}
            />
            {mismatch && (
              <p id="confirm-password-error" className="text-xs text-risk-high mt-1" role="alert">
                The two passwords do not match.
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={submitting || !isPasswordValid(password) || password !== confirm}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <SubmitLabel submitting={submitting} idle="Set new password" busy="Saving…" />
          </button>
        </form>

        <AuthError message={error} />
      </div>
    </AuthShell>
  );
}
