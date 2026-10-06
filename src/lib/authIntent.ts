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

/** Validates the receiving app's checkout trigger as strictly as the auth pages. */
export function readIntentFromCheckout(value: string | null): AuthIntent | null {
  if (!value) return null;
  const match = /^(starter|growth|pro)_(monthly|annual)$/.exec(value);
  return match ? { plan: match[1]!, billing: match[2] as AuthIntent['billing'] } : null;
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
 * Read the stashed intent WITHOUT clearing it.
 *
 * takeAuthIntent() is destructive by design so a completed purchase cannot be
 * replayed. But a recovery link needs to look before it destroys: the OAuth
 * failure screen has to hand the retry something to resume, and calling
 * takeAuthIntent() there would delete the very thing it is trying to pass on.
 */
export function peekAuthIntent(): AuthIntent | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthIntent>;
    if (!parsed.plan || !PLANS.has(parsed.plan)) return null;
    return { plan: parsed.plan, billing: parsed.billing === 'annual' ? 'annual' : 'monthly' };
  } catch {
    return null;
  }
}

/**
 * Resolve where to send a user after authenticating, preferring an explicit
 * same-origin `?redirect=` over the purchase intent.
 *
 * Shared by Login and Signup. Only same-origin paths are accepted: a protocol-
 * relative `//evil.com`, a backslash `/\evil.com`, and any cross-origin URL are
 * all rejected. Signup previously ignored `?redirect=` entirely, so a visitor
 * deep-linked to a protected route who chose "Sign up" was dumped on /app
 * instead of the page they were trying to open.
 */
export function safeRedirectPath(redirect: string | null, intent: AuthIntent | null): string {
  const fallback = destinationFor(intent);
  if (!redirect || !redirect.startsWith('/') || redirect.startsWith('//') || redirect.startsWith('/\\')) {
    return fallback;
  }
  try {
    const parsed = new URL(redirect, window.location.origin);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/') ? redirect : fallback;
  } catch {
    return fallback;
  }
}
