import { useCallback, useEffect, useState } from 'react';
import type { UpgradeRequired } from '@/lib/api';
import { UpgradeRequiredError } from '@/lib/entries';
import { describeError, getCompanyOverview, type CompanyOverview } from '@/lib/company';
import { publishCompanyName } from '@/lib/companyName';

export type CompanyLoad =
  | { status: 'loading' }
  | { status: 'ready'; overview: CompanyOverview }
  /** The plan gate answered 402: the trial is over or nothing was bought. The page shows its own paywall. */
  | { status: 'paused'; upgrade: UpgradeRequired }
  | { status: 'error'; message: string };

type Settled = Exclude<CompanyLoad, { status: 'loading' }>;

/**
 * Loads GET /api/company (bounded at 15 s) and keeps it: the company, whether
 * onboarding is pending, its facilities, the plan cap and the first-run checklist.
 * `retry` loads it again from the loading state; `replace` swaps in a value the
 * caller built from a write's own response, so a save does not need another round
 * trip. A request that is superseded or outlived by an unmount never writes state.
 */
export function useCompanyOverview() {
  const [attempt, setAttempt] = useState(0);
  // The answer belongs to the attempt that asked: a new attempt reads as loading
  // until its own answer arrives, without setting state from inside the effect.
  const [settled, setSettled] = useState<{ attempt: number; load: Settled } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getCompanyOverview(controller.signal).then(
      (overview) => {
        if (controller.signal.aborted) return;
        publishCompanyName(overview.company.name);
        setSettled({ attempt, load: { status: 'ready', overview } });
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setSettled({
          attempt,
          load: err instanceof UpgradeRequiredError
            ? { status: 'paused', upgrade: err.upgrade }
            : { status: 'error', message: describeError(err, 'Loading your company failed.') },
        });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const replace = useCallback(
    (overview: CompanyOverview) => {
      publishCompanyName(overview.company.name);
      setSettled({ attempt, load: { status: 'ready', overview } });
    },
    [attempt],
  );

  const load: CompanyLoad = settled && settled.attempt === attempt ? settled.load : { status: 'loading' };
  return { load, retry, replace };
}
