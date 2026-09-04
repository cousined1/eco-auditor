import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { insforge } from '../lib/insforge';
import { type SocialAuthProvider } from '../lib/socialAuth';
import { readIntentFromParams, destinationFor } from '../lib/authIntent';
import {
  AuthError,
  AuthHeading,
  AuthShell,
  ConfigWarning,
  SocialAuthButtons,
  SubmitLabel,
  TermsNotice,
} from '../components/auth/AuthShell';
import {
  authInputClass,
  startProviderSignIn,
  useNoIndex,
  useRedirectIfAuthenticated,
} from '../components/auth/authHelpers';
import { PasswordInput } from '../components/auth/PasswordInput';

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect');
  // Use the shared intent reader so the email path defaults `billing` exactly
  // the way the OAuth path does. Requiring BOTH plan and billing here meant
  // /login?plan=growth resumed checkout after "Continue with Google" but
  // dropped the sale after an email sign-in on the very same URL.
  const intent = readIntentFromParams(searchParams);
  // Only same-origin paths: prevent protocol-relative (//evil.com), backslash (/\evil.com), and cross-origin bypasses
  const safeRedirect = (() => {
    if (!redirect || !redirect.startsWith('/') || redirect.startsWith('//') || redirect.startsWith('/\\')) {
      return destinationFor(intent);
    }
    try {
      const parsed = new URL(redirect, window.location.origin);
      return parsed.origin === window.location.origin && parsed.pathname.startsWith('/')
        ? redirect
        : destinationFor(intent);
    } catch {
      return destinationFor(intent);
    }
  })();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<SocialAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  useNoIndex();
  useRedirectIfAuthenticated(safeRedirect);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { error: authError } = await insforge.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        setError(authError.message || 'Invalid email or password.');
        return;
      }

      navigate(safeRedirect, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSocialLogin(provider: SocialAuthProvider) {
    setPendingProvider(provider);
    setError(null);
    await startProviderSignIn(
      provider,
      (message) => {
        setError(message);
        setPendingProvider(null);
      },
      readIntentFromParams(searchParams),
    );
  }

  return (
    <AuthShell>
      <AuthHeading
        title="Sign in to Eco-Auditor"
        subtitle="Welcome back. Continue to your emissions ledger, reports, and compliance dashboard."
      />

      <div className="card space-y-3">
        <ConfigWarning action="sign-in" />

        <form onSubmit={(e) => void handleEmailLogin(e)} className="space-y-3">
          <div>
            <label htmlFor="login-email" className="sr-only">Email address</label>
            <input
              id="login-email"
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
          <PasswordInput
            id="login-password"
            label="Password"
            placeholder="Password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            disabled={submitting}
          >
            <div className="mt-1.5 text-right">
              {/* Was a mailto: to an off-brand domain — a locked-out paying
                  customer had to wait for a human, and email-driven manual
                  resets are a standard account-takeover channel. */}
              <Link to="/forgot-password" className="text-xs text-accent-text hover:underline">
                Forgot password?
              </Link>
            </div>
          </PasswordInput>
          <button
            type="submit"
            disabled={submitting || !email.trim() || !password}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <SubmitLabel submitting={submitting} idle="Sign in" busy="Signing in…" />
          </button>
        </form>

        <SocialAuthButtons
          pendingProvider={pendingProvider}
          disabled={submitting}
          onSelect={(provider) => void handleSocialLogin(provider)}
        />

        <AuthError message={error} />
        <TermsNotice />
      </div>

      <p className="mt-6 text-center text-sm text-surface-500">
        Don't have an account?{' '}
        <Link
          to={`/signup${searchParams.toString() ? '?' + searchParams.toString() : ''}`}
          className="font-medium text-accent-text hover:underline"
        >
          Sign up
        </Link>
      </p>
    </AuthShell>
  );
}
