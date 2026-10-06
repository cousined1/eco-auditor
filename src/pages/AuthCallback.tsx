import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { insforge } from '../lib/insforge';
import { destinationFor, peekAuthIntent, takeAuthIntent } from '../lib/authIntent';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [authError, setAuthError] = useState<string | null>(null);

  // The InsForge SDK strips `?error=` from the URL itself: its Auth constructor
  // calls detectAuthCallback(), which runs cleanUrlParams("error") before any
  // await — synchronously, when createClient() is evaluated at module import,
  // which is before React Router snapshots the location. So `error` is normally
  // already gone by the time this component reads it, and the old
  // `searchParams.get('error')` check below was dead code.
  //
  // `error_description` is NOT stripped, so it is the signal that survives. It
  // has to drive the short-circuit too: with `error` gone, the effect used to
  // fall through to getCurrentUser(), which in browser mode answers from any
  // session in local storage — so a denied-consent callback with a stale session
  // navigated to /app as if sign-in had succeeded, and the user never saw the
  // failure at all.
  const providerErrorDescription = searchParams.get('error_description');
  const providerError = searchParams.get('error') || providerErrorDescription;
  const error = providerError
    ? providerErrorDescription || `The sign-in provider returned an error: ${providerError}`
    : authError;

  // Recovery link must not drop a stashed purchase intent. Retrying from a bare
  // /login makes startProviderSignIn clear the intent, so a prospect who chose
  // Growth/annual, failed one Google attempt and retried lost the sale. Peek
  // rather than take — takeAuthIntent() is destructive by design.
  const stashedIntent = peekAuthIntent();
  const retryHref = stashedIntent
    ? `/login?plan=${stashedIntent.plan}&billing=${stashedIntent.billing}`
    : '/login';

  useEffect(() => {
    if (providerError) return;

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
        setAuthError(sessionError?.message || 'We could not finish signing you in. Please try again.');
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
  }, [navigate, providerError]);

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
          <Link to={retryHref} className="btn-primary mt-5 inline-flex">
            Back to login
          </Link>
        )}
      </div>
    </div>
  );
}
