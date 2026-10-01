import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { insforge } from '../lib/insforge';
import { type SocialAuthProvider } from '../lib/socialAuth';
import { readIntentFromParams, resolvePostAuthRedirect } from '../lib/authIntent';
import {
  AuthError,
  AuthHeading,
  AuthInfo,
  AuthShell,
  ConfigWarning,
  SocialAuthButtons,
  SubmitLabel,
  TermsNotice,
} from '../components/auth/AuthShell';
import {
  authInputClass,
  authLabelClass,
  readAuthNotice,
  startProviderSignIn,
  useNoIndex,
  useRedirectIfAuthenticated,
} from '../components/auth/authHelpers';
import {
  isEmailNotVerifiedError,
  verifyEmailHref,
  type VerifyEmailState,
} from '../components/auth/emailVerification';
import { PasswordInput } from '../components/auth/PasswordInput';

const NOTICE_TEXT = {
  'session-expired': 'Your session expired. Sign in again to continue.',
  'email-verified': 'Your email is verified. Sign in to continue.',
} as const;

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  // `?redirect=` if it is a safe same-origin path, else the purchase intent.
  // The shared intent reader defaults `billing` exactly the way the OAuth path
  // does: requiring BOTH plan and billing here meant /login?plan=growth
  // resumed checkout after "Continue with Google" but dropped the sale after
  // an email sign-in on the very same URL.
  const safeRedirect = resolvePostAuthRedirect(searchParams);
  const notice = readAuthNotice(location.state);

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

      if (isEmailNotVerifiedError(authError)) {
        // The password was right but the address was never verified. Printing
        // the raw 403 left the user with no code field and no way to get a
        // new code. The verification step signs them in by itself, so the
        // password is dropped here rather than carried along.
        setPassword('');
        const state: VerifyEmailState = { email: email.trim(), codeSent: false };
        navigate(verifyEmailHref(searchParams), { state });
        return;
      }

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
        subtitle="Welcome back. Continue to your emissions dashboard."
      />

      <div className="card space-y-3">
        <ConfigWarning action="sign-in" />
        <AuthInfo message={notice ? NOTICE_TEXT[notice] : null} />

        <form onSubmit={(e) => void handleEmailLogin(e)} className="space-y-3">
          <div>
            <label htmlFor="login-email" className={authLabelClass}>Email address</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              className={authInputClass}
            />
          </div>
          <PasswordInput
            id="login-password"
            label="Password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            disabled={submitting}
          >
            <div className="mt-1.5 text-right">
              {/* Was a mailto: to an off-brand domain — a locked-out paying
                  customer had to wait for a human, and email-driven manual
                  resets are a standard account-takeover channel. */}
              <Link to="/forgot-password/" className="text-xs text-accent-text hover:underline">
                Forgot password?
              </Link>
            </div>
          </PasswordInput>
          <AuthError message={error} />
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

        <TermsNotice />
      </div>

      <p className="mt-6 text-center text-sm text-surface-500">
        Don't have an account?{' '}
        <Link
          to={`/signup/${searchParams.toString() ? '?' + searchParams.toString() : ''}`}
          className="font-medium text-accent-text hover:underline"
        >
          Sign up
        </Link>
      </p>
      {/* A way back to the code step that does not depend on the sign-in
          error: someone who closed the tab after signing up can still finish. */}
      <p className="mt-2 text-center text-sm text-surface-500">
        Signed up but not verified yet?{' '}
        <Link to={verifyEmailHref(searchParams)} className="font-medium text-accent-text hover:underline">
          Enter your code
        </Link>
      </p>
    </AuthShell>
  );
}
