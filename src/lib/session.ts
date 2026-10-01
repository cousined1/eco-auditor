import { apiFetch } from './api';

// A real server round-trip to confirm the session. The browser SDK's
// insforge.auth.getCurrentUser() only reads cached session state, so it never
// detects server-side expiry — this hits an auth-guarded endpoint instead.
// apiFetch refreshes an expired access token on the way, and reports a session
// that cannot be recovered through onSessionExpired (src/lib/api.ts), so
// callers need not act on the result to get the user re-authenticated.
//
// There is deliberately no global window.fetch patch any more: it signed the
// user out on the first 401 instead of refreshing, and it was reinstalled on
// every route change, leaving each new page's first request unguarded.
export async function isSessionValid(): Promise<boolean> {
  try {
    // RT-06: bound the round-trip; a hung connection is treated like any other
    // network error below (no false logout on a blip or timeout).
    const res = await apiFetch('/api/trial-status', { signal: AbortSignal.timeout(15000) });
    return res.status !== 401;
  } catch {
    // Network/transient error — don't force a logout on a blip.
    return true;
  }
}
