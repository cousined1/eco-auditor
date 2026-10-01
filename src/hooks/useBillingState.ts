import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBillingState, onBillingChanged, type BillingState } from '../lib/billingState';

// A page view reloads the billing state, at most once a minute: each reload is one
// authenticated API call, and the trial clock moves by the day.
const REFRESH_AFTER_MS = 60_000;

/**
 * The signed-in user's billing state for a surface that only displays it (the
 * trial pill, the Pricing buttons). null until it arrives, when `enabled` is
 * false, and whenever it cannot be loaded. Pass something that changes with the
 * page (the pathname) as `pageKey` to have it refreshed on navigation.
 */
export function useBillingState(enabled = true, pageKey = ''): BillingState | null {
  const [state, setState] = useState<BillingState | null>(null);
  const loadedAt = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(() => {
    loadedAt.current = Date.now();
    void fetchBillingState().then((next) => {
      if (!mounted.current || !next) return;
      setState(next);
      // A company that does not exist yet has no trial end to show. The first data
      // request creates it and is usually in flight at this very moment, so ask
      // again at the next page view instead of waiting out the minute.
      if (next.source === 'pending') loadedAt.current = 0;
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (loadedAt.current === 0 || Date.now() - loadedAt.current >= REFRESH_AFTER_MS) load();
  }, [enabled, pageKey, load]);

  // Something changed the subscription: reload now rather than at the next page view.
  useEffect(() => (enabled ? onBillingChanged(load) : undefined), [enabled, load]);

  return enabled ? state : null;
}
