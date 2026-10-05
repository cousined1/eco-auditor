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
