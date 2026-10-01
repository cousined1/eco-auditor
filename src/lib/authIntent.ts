// Carries a purchase intent across an OAuth round-trip.
//
// Starting checkout from /pricing puts `plan` and `billing` in the query
// string, and the email login path threads them through to /app?checkout=…
// The OAuth path could not: the provider redirects to a fixed callback URL that
// has to match the backend's allowed-redirect list exactly, so the params
// cannot ride along in the URL. A prospect who picked a plan and then chose
// "Continue with Google" landed on an empty dashboard with the sale dropped.
//
// sessionStorage is the right store here: the OAuth flow returns to the same
// tab and origin, and the intent should not outlive the browser session.

const KEY = 'ecoauditor.auth.intent';

export type AuthIntent = { plan: string; billing: 'monthly' | 'annual' };

const PLANS = new Set(['starter', 'growth', 'pro']);

/** Reads a plan intent out of a query string, if it holds a valid one. */
export function readIntentFromParams(params: URLSearchParams): AuthIntent | null {
  const plan = params.get('plan');
  if (!plan || !PLANS.has(plan)) return null;
  return { plan, billing: params.get('billing') === 'annual' ? 'annual' : 'monthly' };
}

/** Stashes the intent before handing control to an OAuth provider. */
export function saveAuthIntent(intent: AuthIntent | null): void {
  try {
    if (intent) sessionStorage.setItem(KEY, JSON.stringify(intent));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Private mode or storage disabled — the sign-in still works, the user
    // just lands on the dashboard instead of at checkout.
  }
}

/** Reads and clears the stashed intent. Safe to call when none was set. */
export function takeAuthIntent(): AuthIntent | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthIntent>;
    if (!parsed.plan || !PLANS.has(parsed.plan)) return null;
    return { plan: parsed.plan, billing: parsed.billing === 'annual' ? 'annual' : 'monthly' };
  } catch {
    return null;
  }
}

/** Post-authentication destination for an intent — the app's checkout trigger. */
export function destinationFor(intent: AuthIntent | null): string {
  return intent ? `/app?checkout=${intent.plan}_${intent.billing}` : '/app';
}

/**
 * Where a user goes after signing in or verifying their email: the `?redirect=`
 * path when it is a safe same-origin path, otherwise the purchase intent's
 * destination. Shared by /login and the email-verification step so the
 * open-redirect guard exists once.
 *
 * Only same-origin paths: prevents protocol-relative (//evil.com), backslash
 * (/\evil.com) and cross-origin bypasses. `window` is read only once a
 * candidate path passed the prefix checks, because /login is prerendered.
 */
export function resolvePostAuthRedirect(params: URLSearchParams, origin?: string): string {
  const fallback = destinationFor(readIntentFromParams(params));
  const redirect = params.get('redirect');
  if (!redirect || !redirect.startsWith('/') || redirect.startsWith('//') || redirect.startsWith('/\\')) {
    return fallback;
  }
  try {
    const base = origin ?? window.location.origin;
    const parsed = new URL(redirect, base);
    return parsed.origin === base && parsed.pathname.startsWith('/') ? redirect : fallback;
  } catch {
    return fallback;
  }
}
