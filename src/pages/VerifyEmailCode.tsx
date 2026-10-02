import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { insforge } from '../lib/insforge';
import { resolvePostAuthRedirect } from '../lib/authIntent';
import {
  AuthError,
  AuthHeading,
  AuthShell,
  ConfigWarning,
  SubmitLabel,
} from '../components/auth/AuthShell';
import {
  authFieldErrorClass,
  authHintClass,
  authInputClass,
  authLabelClass,
  useNoIndex,
  useRedirectIfAuthenticated,
  type AuthNoticeState,
} from '../components/auth/authHelpers';
import {
  RESEND_COOLDOWN_SECONDS,
  VERIFICATION_CODE_LENGTH,
  normalizeVerificationCode,
  readVerifyEmailState,
} from '../components/auth/emailVerification';

const RETRY_LATER = 'We could not reach the server. Please try again.';
// One message for every rejected code (wrong, expired, or an address with no
// account), so the form cannot be used to learn which addresses have accounts.
const INVALID_CODE = 'That code is not valid or has expired. Check the newest verification email, or send a new code.';
const TOO_MANY_ATTEMPTS = 'Too many attempts. Wait a minute, then try again.';

/** Network failure (0), timeout (408) or server error: nothing is wrong with the code itself. */
function isTransient(statusCode: number): boolean {
  return statusCode === 0 || statusCode === 408 || statusCode >= 500;
}

/**
 * Email verification, code method (see emailVerification.ts).
 *
 * Reached right after sign-up, when a code has just been sent, and from /login
 * when a sign-in is refused because the address is not verified yet.
 * verifyEmail() returns a session, so a correct code signs the user straight
 * in: no second password entry, and a plan picked before sign-up still resumes
 * its checkout. The code is never logged or stored outside this component.
 */
export default function VerifyEmailCode() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const arrival = readVerifyEmailState(location.state);
  const destination = resolvePostAuthRedirect(searchParams);
  const query = searchParams.toString() ? `?${searchParams.toString()}` : '';

  const [email, setEmail] = useState(arrival?.email ?? '');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState('');
  // A code was sent a moment ago on the sign-up path; a resend right away
  // would only replace it before it arrives.
  const [cooldown, setCooldown] = useState(arrival?.codeSent ? RESEND_COOLDOWN_SECONDS : 0);

  useNoIndex();
  useRedirectIfAuthenticated(destination);

  const coolingDown = cooldown > 0;
  useEffect(() => {
    if (!coolingDown) return;
    const id = window.setInterval(() => {
      setCooldown((seconds) => (seconds > 1 ? seconds - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [coolingDown]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCodeError(null);
    if (code.length !== VERIFICATION_CODE_LENGTH) {
      setCodeError(`Enter the ${VERIFICATION_CODE_LENGTH}-digit code from the email.`);
      return;
    }

    setSubmitting(true);
    try {
      const { data, error: verifyError } = await insforge.auth.verifyEmail({ email: email.trim(), otp: code });
      if (verifyError) {
        if (isTransient(verifyError.statusCode)) setError(RETRY_LATER);
        else setCodeError(verifyError.statusCode === 429 ? TOO_MANY_ATTEMPTS : INVALID_CODE);
        return;
      }

      setCode('');
      if (data?.accessToken) {
        navigate(destination, { replace: true });
        return;
      }
      // Verified, but no session came back: the user signs in as usual.
      const state: AuthNoticeState = { authNotice: 'email-verified' };
      navigate(`/login${query}`, { replace: true, state });
    } catch {
      setError(RETRY_LATER);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    const address = email.trim();
    setError(null);
    setCodeError(null);
    setResendStatus('');
    setResending(true);
    try {
      // No redirectTo: it only applies to link verification, and an address
      // missing from the auth redirect allowlist is rejected with a 400.
      const { error: resendError } = await insforge.auth.resendVerificationEmail({ email: address });
      // "No such account" (404) reads like a success, as on the password-reset
      // form, so this cannot become an account-existence oracle either.
      if (resendError && resendError.statusCode !== 404) {
        setError(
          resendError.statusCode === 429
            ? 'Too many requests. Wait a minute before asking for another code.'
            : 'We could not send a new code right now. Please try again.',
        );
        return;
      }
      setCode('');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setResendStatus(`If ${address} is waiting for verification, a new code is on its way. Use the code from the newest email.`);
    } catch {
      setError('We could not send a new code right now. Please try again.');
    } finally {
      setResending(false);
    }
  }

  const subtitle = arrival?.codeSent
    ? `We sent a ${VERIFICATION_CODE_LENGTH}-digit code to ${arrival.email}. Enter it below to verify your email and sign in.`
    : arrival
      ? `Your email address is not verified yet. Enter the ${VERIFICATION_CODE_LENGTH}-digit code from your verification email, or send a new one.`
      : `Enter the email you signed up with and the ${VERIFICATION_CODE_LENGTH}-digit code we sent you.`;

  return (
    <AuthShell>
      <AuthHeading title={arrival?.codeSent ? 'Check your email' : 'Verify your email'} subtitle={subtitle} />

      <div className="card space-y-3">
        <ConfigWarning action="email verification" />

        <form onSubmit={(e) => void handleVerify(e)} className="space-y-3">
          <div>
            <label htmlFor="verify-email" className={authLabelClass}>Email address</label>
            <input
              id="verify-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              className={authInputClass}
            />
          </div>
          <div>
            <label htmlFor="verify-code" className={authLabelClass}>Verification code</label>
            <input
              id="verify-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => {
                setCode(normalizeVerificationCode(e.target.value));
                setCodeError(null);
              }}
              disabled={submitting}
              aria-invalid={codeError !== null}
              aria-describedby={codeError ? 'verify-code-error verify-code-hint' : 'verify-code-hint'}
              className={`${authInputClass} tracking-[0.3em]`}
            />
            <p id="verify-code-hint" className={authHintClass}>
              The {VERIFICATION_CODE_LENGTH}-digit code from your verification email.
            </p>
            {codeError && (
              <p id="verify-code-error" role="alert" className={authFieldErrorClass}>
                {codeError}
              </p>
            )}
          </div>
          <AuthError message={error} />
          <button
            type="submit"
            disabled={submitting || !email.trim() || code.length !== VERIFICATION_CODE_LENGTH}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <SubmitLabel submitting={submitting} idle="Verify and continue" busy="Verifying…" />
          </button>
        </form>

        <div className="space-y-1 text-center">
          <button
            type="button"
            onClick={() => void handleResend()}
            disabled={resending || coolingDown || submitting || !email.trim()}
            className="text-xs font-medium text-accent-text hover:underline disabled:cursor-not-allowed disabled:opacity-60 disabled:no-underline"
          >
            {coolingDown ? `Send a new code (available in ${cooldown}s)` : resending ? 'Sending…' : 'Send a new code'}
          </button>
          {/* Always mounted, so the resend confirmation is announced when it appears. */}
          <p role="status" className="text-xs text-surface-600 dark:text-surface-400">
            {resendStatus}
          </p>
        </div>
      </div>

      <p className="mt-6 text-center text-sm text-surface-500">
        Wrong email address?{' '}
        <Link to={`/signup/${query}`} className="font-medium text-accent-text hover:underline">
          Sign up again
        </Link>
        {' · '}
        <Link to={`/login/${query}`} className="font-medium text-accent-text hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
