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
  authFieldErrorClass,
  authHintClass,
  authInputClass,
  authLabelClass,
  startProviderSignIn,
  useNoIndex,
  useRedirectIfAuthenticated,
} from '../components/auth/authHelpers';
import { verifyEmailHref, type VerifyEmailState } from '../components/auth/emailVerification';
import { PasswordInput } from '../components/auth/PasswordInput';
import { trialHeadline, trialLimitsLabel } from '@/content/pricing';

// Client-side password policy: min 8 chars with at least one letter and one number.
const PASSWORD_MIN_LENGTH = 8;
const isPasswordValid = (value: string) =>
  value.length >= PASSWORD_MIN_LENGTH && /[a-zA-Z]/.test(value) && /\d/.test(value);

export default function Signup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<SocialAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passwordTouched, setPasswordTouched] = useState(false);

  useNoIndex();
  // An already-authenticated visitor arriving at /signup?plan=growth&billing=annual
  // was bounced to a bare /app, silently dropping the plan they had just picked.
  // Login preserves the intent; Signup now does too.
  useRedirectIfAuthenticated(destinationFor(readIntentFromParams(searchParams)));

  // The rule is always shown as helper text; the error waits until the user
  // leaves the field (or submits) with something typed, instead of firing on
  // the first keystroke. An empty field is not "wrong yet".
  const passwordInvalid = passwordTouched && password.length > 0 && !isPasswordValid(password);

  async function handleEmailSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isPasswordValid(password)) {
      setPasswordTouched(true);
      return;
    }

    setSubmitting(true);

    try {
      // No redirectTo: it is only used for link verification, and /login is
      // not in the project's auth redirect allowlist (insforge.toml), which
      // InsForge answers with a 400. This project verifies with a code.
      const { data, error: authError } = await insforge.auth.signUp({
        email: email.trim(),
        password,
        ...(name.trim() ? { name: name.trim() } : {}),
      });

      if (authError) {
        setError(authError.message || 'Unable to create account.');
        return;
      }

      // signUp returns an accessToken when auto-confirm is on; navigate straight to app.
      if (data?.accessToken) {
        navigate(destinationFor(readIntentFromParams(searchParams)), { replace: true });
        return;
      }

      // Email verification is on (code method): the account exists but has no
      // session until the emailed code is entered. The next step signs the
      // user in, so the password is not needed again and is dropped here.
      setPassword('');
      const state: VerifyEmailState = { email: email.trim(), codeSent: true };
      navigate(verifyEmailHref(searchParams), { replace: true, state });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSocialSignup(provider: SocialAuthProvider) {
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
        title="Start your free trial"
        subtitle={
          // Arriving with ?plan= means the next hop is Stripe Checkout, which
          // collects a card — "No card required" must not appear on that path.
          // Also drops "up and running quickly" (claims.ts marks it unverified,
          // review overdue 2026-08-15).
          // See ecoauditor-mvp-readiness-audit-2026-08-20.md (E-7, E-8).
          // The card-free trial is a Starter trial (F-A-09): name its tier and
          // limits from pricing.ts, which reads plan-limits.json.
          searchParams.get('plan')
            ? '14-day free trial on monthly Starter and Growth plans · Cancel anytime before the trial ends. A payment method is required to start a trial from a selected plan.'
            : `${trialHeadline()} · No card required · ${trialLimitsLabel()}.`
        }
      />

      <div className="card space-y-3">
        <ConfigWarning action="sign-up" />

        <form onSubmit={(e) => void handleEmailSignup(e)} className="space-y-3">
          <div>
            <label htmlFor="signup-name" className={authLabelClass}>Full name (optional)</label>
            <input
              id="signup-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              className={authInputClass}
            />
          </div>
          <div>
            <label htmlFor="signup-email" className={authLabelClass}>Email address</label>
            <input
              id="signup-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              className={authInputClass}
            />
          </div>
          {/* The submit button is disabled by the same isPasswordValid() test
              that guards handleEmailSignup, so the rule has to be visible
              before anything is typed: it is static helper text (it used to
              live in the placeholder, which disappears on the first
              keystroke), and the error only appears once the user leaves the
              field with a non-conforming password. */}
          <PasswordInput
            id="signup-password"
            label="Password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            value={password}
            onChange={setPassword}
            onBlur={() => setPasswordTouched(true)}
            disabled={submitting}
            invalid={passwordInvalid}
            hintId="signup-password-hint"
            {...(passwordInvalid ? { errorId: 'signup-password-error' } : {})}
          >
            <p id="signup-password-hint" className={authHintClass}>
              At least 8 characters, with at least one letter and one number.
            </p>
            {passwordInvalid && (
              <p id="signup-password-error" className={authFieldErrorClass} role="alert">
                Password must be at least 8 characters and include at least one letter and one number.
              </p>
            )}
          </PasswordInput>
          <AuthError message={error} />
          <button
            type="submit"
            disabled={submitting || !email.trim() || !isPasswordValid(password)}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <SubmitLabel submitting={submitting} idle="Create account" busy="Creating account…" />
          </button>
        </form>

        <SocialAuthButtons
          pendingProvider={pendingProvider}
          disabled={submitting}
          onSelect={(provider) => void handleSocialSignup(provider)}
        />

        <TermsNotice />
      </div>

      <p className="mt-6 text-center text-sm text-surface-500">
        Already have an account?{' '}
        <Link
          to={`/login/${searchParams.toString() ? '?' + searchParams.toString() : ''}`}
          className="font-medium text-accent-text hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
