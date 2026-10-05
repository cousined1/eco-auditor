import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { insforge } from '../lib/insforge';
import { type SocialAuthProvider } from '../lib/socialAuth';
import { readIntentFromParams, safeRedirectPath } from '../lib/authIntent';
import { PLANS } from '../content/pricing';
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

// Client-side password policy: min 8 chars with at least one letter and one number.
const PASSWORD_MIN_LENGTH = 8;
const isPasswordValid = (value: string) =>
  value.length >= PASSWORD_MIN_LENGTH && /[a-zA-Z]/.test(value) && /\d/.test(value);

export default function Signup() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<SocialAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needsVerification = searchParams.get('verify') === '1';
  const [code, setCode] = useState('');
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);
  const intent = readIntentFromParams(searchParams);
  const selectedPlan = intent ? PLANS[intent.plan as keyof typeof PLANS] : null;
  const trialEligible = !intent || (intent.billing === 'monthly' && intent.plan !== 'pro');
  const busy = submitting || pendingProvider !== null;

  // App.tsx sends anonymous visitors on a protected route to
  // /login?redirect=<path+search>, and Login forwards every param to /signup.
  // Signup ignored ?redirect= and always landed on /app — or on
  // destinationFor(intent) — so a deep link lost the page the visitor was
  // actually trying to open. Resolved through the same helper Login uses, so
  // the two cannot drift on the same-origin checks.
  const safeRedirect = safeRedirectPath(searchParams.get('redirect'), intent);

  useNoIndex();
  // An already-authenticated visitor arriving at /signup?plan=growth&billing=annual
  // was bounced to a bare /app, silently dropping the plan they had just picked.
  // Login preserves the intent; Signup now does too.
  useRedirectIfAuthenticated(safeRedirect);

  // Only once the user has typed something — an empty field is not "wrong yet".
  const passwordInvalid = password.length > 0 && !isPasswordValid(password);

  async function handleEmailSignup(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (!isPasswordValid(password)) {
      setError('Password must be at least 8 characters and include at least one letter and one number.');
      return;
    }

    setSubmitting(true);

    try {
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
      // Without a token, the user must verify their email first.
      if (data?.accessToken) {
        navigate(safeRedirect, { replace: true });
      } else {
        setPassword('');
        const verificationParams = new URLSearchParams(searchParams);
        verificationParams.set('verify', '1');
        setSearchParams(verificationParams, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerification(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !email.trim() || !/^\d{6}$/.test(code.trim())) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: verificationError } = await insforge.auth.verifyEmail({
        email: email.trim(), otp: code.trim(),
      });
      if (verificationError || !data?.accessToken) {
        setError(verificationError?.message || 'We could not verify your email. Check the code and try again.');
        return;
      }
      navigate(safeRedirect, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify your email. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function resendCode() {
    if (busy || !email.trim()) return;
    setSubmitting(true);
    setError(null);
    setVerificationNotice(null);
    try {
      const { error: resendError } = await insforge.auth.resendVerificationEmail({ email: email.trim() });
      if (resendError) setError(resendError.message || 'Unable to resend the code. Please try again.');
      else setVerificationNotice('A new verification code has been sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resend the code. Please try again.');
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

  if (needsVerification) {
    return (
      <AuthShell centered>
        <div className="card">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
            <svg className="h-6 w-6 text-accent-text" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-surface-900 dark:text-white">Check your email</h1>
          <p className="mt-2 text-sm text-surface-500">
            Enter your email address and the six-digit code in the verification email to continue.
          </p>
          {selectedPlan && intent && (
            <p className="mt-3 text-sm text-surface-700 dark:text-surface-300">
              Your selection: {selectedPlan.name}, billed {intent.billing === 'annual' ? 'annually' : 'monthly'}.
            </p>
          )}
          <form onSubmit={(e) => void handleVerification(e)} className="mt-4 space-y-3 text-left">
            <label htmlFor="verification-email" className="block text-sm font-medium">Email address</label>
            <input id="verification-email" type="email" autoComplete="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} disabled={busy} className={authInputClass} />
            <label htmlFor="signup-code" className="block text-sm font-medium">Verification code</label>
            <input id="signup-code" type="text" inputMode="numeric" autoComplete="one-time-code"
              pattern="[0-9]{6}" maxLength={6} required value={code}
              onChange={(e) => setCode(e.target.value)} disabled={busy} className={authInputClass} />
            <AuthError message={error} />
            {verificationNotice && <p role="status" className="text-sm">{verificationNotice}</p>}
            <button type="submit" disabled={busy || !email.trim() || !/^\d{6}$/.test(code.trim())} className="btn-primary w-full">
              <SubmitLabel submitting={submitting} idle="Verify email and continue" busy="Please wait…" />
            </button>
            <button type="button" disabled={busy || !email.trim()} onClick={() => void resendCode()} className="btn-secondary w-full">
              Resend verification code
            </button>
          </form>
          <Link
            to={`/login${searchParams.toString() ? '?' + searchParams.toString() : ''}`}
            className="btn-primary mt-6 inline-flex"
          >
            Go to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthHeading
        title={trialEligible ? 'Start your free trial' : 'Create your account'}
        subtitle={
          // Arriving with ?plan= means the next hop is Stripe Checkout, which
          // collects a card — "No card required" must not appear on that path.
          // Also drops "up and running quickly" (claims.ts marks it unverified,
          // review overdue 2026-08-15).
          // See ecoauditor-mvp-readiness-audit-2026-08-20.md (E-7, E-8).
          intent
            ? trialEligible
              ? '14-day free trial · A payment method is required at checkout · Cancel before the trial ends to avoid a charge.'
              : 'Continue to secure checkout. Your selected plan is billed immediately; no free trial is included.'
            : '14-day free trial · No card required · Cancel anytime.'
        }
      />
      {selectedPlan && intent && (
        <p className="mb-4 text-center text-sm text-surface-700 dark:text-surface-300" role="status">
          {selectedPlan.name} · ${intent.billing === 'annual' ? selectedPlan.annual.toLocaleString('en-US') : selectedPlan.monthly.toLocaleString('en-US')}
          {intent.billing === 'annual' ? '/year, billed annually' : '/month, billed monthly'}
        </p>
      )}

      <div className="card space-y-3">
        <ConfigWarning action="sign-up" />

        <form onSubmit={(e) => void handleEmailSignup(e)} className="space-y-3">
          <div>
            <label htmlFor="signup-name" className="sr-only">Full name</label>
            <input
              id="signup-name"
              type="text"
              autoComplete="name"
              placeholder="Full name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              className={authInputClass}
            />
          </div>
          <div>
            <label htmlFor="signup-email" className="sr-only">Email address</label>
            <input
              id="signup-email"
              type="email"
              autoComplete="email"
              required
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              className={authInputClass}
            />
          </div>
          {/* The submit button is disabled by the same isPasswordValid() test
              that guards handleEmailSignup, so the policy message inside the
              handler could never fire: a user who typed a non-conforming
              password got a permanently greyed-out button, no explanation, and
              no visible rule — the placeholder that stated it disappears as
              soon as the field has a value. This surfaces the rule inline, the
              way ForgotPassword already does for its mismatch case. */}
          <PasswordInput
            id="signup-password"
            label="Password"
            placeholder="Password (8+ characters, with a letter and a number)"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            value={password}
            onChange={setPassword}
            disabled={busy}
            invalid={passwordInvalid}
            {...(passwordInvalid ? { errorId: 'signup-password-error' } : {})}
          >
            {passwordInvalid && (
              <p id="signup-password-error" className="text-xs text-risk-high mt-1" role="alert">
                Password must be at least 8 characters and include at least one letter and one number.
              </p>
            )}
          </PasswordInput>
          <button
            type="submit"
            disabled={busy || !email.trim() || !isPasswordValid(password)}
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

        <AuthError message={error} />
        <TermsNotice />
      </div>

      <p className="mt-6 text-center text-sm text-surface-500">
        Already have an account?{' '}
        <Link
          to={`/login${searchParams.toString() ? '?' + searchParams.toString() : ''}`}
          className="font-medium text-accent-text hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
