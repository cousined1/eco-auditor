import { useState, useSyncExternalStore } from 'react';
import { getConnectionProblem, retryConnection, signInAgain, subscribeConnectionProblem } from '../lib/api';

const ACTION =
  'rounded-sm text-sm font-medium text-surface-800 underline hover:text-surface-950 disabled:cursor-wait disabled:opacity-60 dark:text-surface-100 dark:hover:text-white';

/**
 * Shown in the app shell while refreshing the session keeps failing for a
 * transient reason (I-1, see src/lib/api.ts). The user is still signed in and
 * each screen shows its own error for the request that failed; this says why,
 * and offers the two things that can help: try again, or sign in again. It never
 * ends the session by itself, and it goes away as soon as the session works.
 */
export default function ConnectionProblemBanner() {
  const active = useSyncExternalStore(subscribeConnectionProblem, getConnectionProblem, () => false);
  const [retrying, setRetrying] = useState(false);

  if (!active) return null;

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await retryConnection();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div role="alert" className="border-b border-risk-high/20 bg-risk-high/10 px-6 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="text-sm text-risk-high">Connection problem: we could not refresh your session.</span>
        <span className="flex items-center gap-4">
          <button type="button" onClick={() => void retry()} disabled={retrying} className={ACTION}>
            Retry
          </button>
          <button type="button" onClick={signInAgain} className={ACTION}>
            Sign in again
          </button>
        </span>
      </div>
    </div>
  );
}
