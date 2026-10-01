import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { insforge } from '../lib/insforge';
import { destinationFor, takeAuthIntent } from '../lib/authIntent';

// The page never shows the raw reason (F-C-25). An SDK error reads like
// "No valid refresh token provided", and a provider's `error_description` is
// whatever text is in the callback URL, which anyone can link to. The reason
// goes to the console; the visitor gets a sentence they can act on.
const SIGN_IN_FAILED = 'We could not finish signing you in. Go back to the login page and try again.';
const SIGN_IN_CANCELLED = 'Sign-in was cancelled before it finished. Go back to the login page to try again.';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [authError, setAuthError] = useState<string | null>(null);

  const providerError = searchParams.get('error');
  const providerDescription = searchParams.get('error_description');
  const error = providerError
    ? providerError === 'access_denied' ? SIGN_IN_CANCELLED : SIGN_IN_FAILED
    : authError;

  useEffect(() => {
    if (providerError) {
      console.warn('[AuthCallback] the sign-in provider returned an error', { error: providerError, description: providerDescription });
      return;
    }

    let cancelled = false;

    async function finishOAuth() {
      // getCurrentUser follows the {data, error} SDK shape for normal
      // failures, but a thrown fault (network drop mid-callback) must still
      // surface here — an escaping rejection left this page on its spinner
      // forever with no recovery link.
      const { data, error: sessionError } = await insforge.auth
        .getCurrentUser()
        .catch((thrown) => ({
          data: null,
          error:
            thrown instanceof Error
              ? thrown
              : new Error('We could not finish signing you in.'),
        }));
      if (cancelled) return;

      if (sessionError || !data?.user) {
        if (sessionError) console.warn('[AuthCallback] could not read the session after sign-in:', sessionError.message);
        setAuthError(SIGN_IN_FAILED);
        return;
      }

      // Navigate to /app — the first API call there (e.g. /api/emissions/summary)
      // triggers ensureCompanyForUser on the server, which auto-provisions a
      // company with a 14-day trial_ends_at for first-time users.
      //
      // If the visitor picked a plan before choosing an OAuth provider, resume
      // that checkout instead of dropping them on an empty dashboard. This
      // hardcoded '/app' was where the purchase intent used to die.
      navigate(destinationFor(takeAuthIntent()), { replace: true });
    }

    void finishOAuth();
    return () => {
      cancelled = true;
    };
  }, [navigate, providerError, providerDescription]);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex items-center justify-center px-6">
      <div className="card max-w-md text-center">
        {!error && (
          <div className="mx-auto mb-4 h-10 w-10 rounded-full border-2 border-brand-600 border-t-transparent animate-spin" />
        )}
        <h1 className="text-lg font-semibold text-surface-900 dark:text-white">
          {error ? 'Sign-in needs another try' : 'Finishing sign-in'}
        </h1>
        <p className="mt-2 text-sm text-surface-500">
          {error || 'Securely confirming your Eco-Auditor session.'}
        </p>
        {error && (
          <Link to="/login/" className="btn-primary mt-5 inline-flex">
            Back to login
          </Link>
        )}
      </div>
    </div>
  );
}
