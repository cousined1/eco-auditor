// ─── Stripe Integration for Eco-Auditor ───────────────────────────────────────
// Updated: Real price IDs mapped from environment variables, with placeholder fallbacks.
// The VITE_STRIPE_PK must be set at build time for client-side checkout to work.
// The server-side /api/stripe/checkout route uses STRIPE_SECRET_KEY at runtime.

import { insforge as _insforge } from './insforge';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const insforge = _insforge as any;

// Resolves the InsForge access token for the current session. Returns null if
// the user is not signed in — callers should treat that as an auth error.
// NOTE: `insforge.auth.getSession()` is not part of the SDK's public Auth
// contract (and returns a camelCase `accessToken` shape, not `data.session`),
// so the previous implementation always returned null — silently breaking
// checkout, billing portal, plan change, and cancel for every signed-in user.
// Read the Authorization header the SDK's HTTP client already manages instead
// (same mechanism as src/lib/api.ts / Dashboard). See audit finding.
export async function getAuthToken(): Promise<string | null> {
  try {
    const headers = insforge.getHttpClient?.().getHeaders?.() || {};
    const authorization: string = headers.Authorization || headers.authorization || '';
    if (!authorization) return null;
    const token = authorization.replace(/^Bearer\s+/i, '');
    // The SDK's HttpClient.getHeaders() falls back to the public anon key when
    // no user session exists ("const authToken = this.userToken || this.anonKey").
    // Callers use this helper as an "is signed in" gate (Pricing checkout), so
    // the always-present anon key must read as signed-out (null), or the
    // anonymous funnel POSTs the anon key to /api/checkout and dies on a raw
    // 401 instead of redirecting to /signup.
    const anonKey = (import.meta.env.VITE_INSFORGE_ANON_KEY as string | undefined) || '';
    if (!token || (anonKey && token === anonKey)) return null;
    return token;
  } catch {
    return null;
  }
}

interface CheckoutParams {
  priceId: string;
  planId: string;
  billing: 'monthly' | 'annual';
  trial?: boolean | undefined;
}

interface PriceConfig {
  starter: { monthly: string | null; annual: string | null };
  growth:  { monthly: string | null; annual: string | null };
  pro:     { monthly: string | null; annual: string | null };
  pk:      string | null;
}

let _priceCache: PriceConfig | null = null;
let _priceCachePromise: Promise<PriceConfig> | null = null;

async function fetchPriceConfig(): Promise<PriceConfig> {
  if (_priceCache) return _priceCache;
  if (_priceCachePromise) return _priceCachePromise;

  _priceCachePromise = fetch('/api/config/prices', { signal: AbortSignal.timeout(15000) })
    .then(async (res) => {
      if (!res.ok) throw new Error('Failed to load price config');
      const data = (await res.json()) as PriceConfig;
      _priceCache = data;
      return data;
    })
    .catch((err) => {
      console.warn('[Stripe] Could not fetch price config, using placeholders:', err);
      // Do NOT promote the failure into the cache. Caching it meant one
      // transient 500 on /api/config/prices wedged checkout for the rest of
      // the session -- every retry returned the null fallback and the user saw
      // "Invalid plan selection" until they reloaded the page.
      _priceCachePromise = null;
      const fallback: PriceConfig = {
        starter: { monthly: null, annual: null },
        growth:  { monthly: null, annual: null },
        pro:     { monthly: null, annual: null },
        pk:      null,
      };
      return fallback;
    });

  return _priceCachePromise;
}




// Legacy build-time fallback (used only before fetch completes)
const STRIPE_PK = import.meta.env.VITE_STRIPE_PK;
if (!STRIPE_PK || STRIPE_PK === 'pk_test_placeholder' || STRIPE_PK === 'pk_live_placeholder') {
  console.warn('[Stripe] VITE_STRIPE_PK is not configured — billing features will be unavailable');
}

type StripeResult<T> = { ok: true; data: T } | { ok: false; error: string };

export const PRICE_IDS = {
  starter: {
    monthly: import.meta.env.VITE_STRIPE_PRICE_STARTER_MONTHLY || 'price_starter_monthly_unconfigured',
    annual: import.meta.env.VITE_STRIPE_PRICE_STARTER_ANNUAL || 'price_starter_annual_unconfigured',
  },
  growth: {
    monthly: import.meta.env.VITE_STRIPE_PRICE_GROWTH_MONTHLY || 'price_growth_monthly_unconfigured',
    annual: import.meta.env.VITE_STRIPE_PRICE_GROWTH_ANNUAL || 'price_growth_annual_unconfigured',
  },
  pro: {
    monthly: import.meta.env.VITE_STRIPE_PRICE_PRO_MONTHLY || 'price_pro_monthly_unconfigured',
    annual: import.meta.env.VITE_STRIPE_PRICE_PRO_ANNUAL || 'price_pro_annual_unconfigured',
  },
} as const;

export async function createCheckoutSession({ planId, billing, trial }: CheckoutParams): Promise<StripeResult<{ url: string }>> {
  const config = await fetchPriceConfig();
  const priceId = config[planId as keyof Omit<PriceConfig, 'pk'>]?.[billing];
  // A null priceId almost always means the config fetch failed, not that the
  // user picked something invalid. Blaming their selection sent them in circles.
  if (!priceId) {
    return { ok: false, error: 'Pricing is temporarily unavailable. Please try again in a moment.' };
  }

  // The server creates the Stripe Checkout session and returns the hosted URL.
  // We do not require a client-side publishable key since Stripe.js is not used.

  const token = await getAuthToken();
  if (!token) return { ok: false, error: 'You must be signed in to start checkout' };

  try {
    const resp = await fetch('/api/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ priceId, planId, billing, trial }),
      // RT-06: bound every client fetch so a black-holed connection cannot
      // leave the UI pending forever; the existing catch maps the abort into
      // the { ok: false, error } shape.
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { ok: false, error: (body as { error?: string }).error || 'Checkout session creation failed' };
    }

    const data = (await resp.json()) as { url: string };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Reconciles a completed checkout against Stripe on return to the app.
 * The webhook is the primary path; this covers the window where it has not
 * landed yet, so a customer who just paid is not left behind the paywall.
 * The server checks the session belongs to the caller before granting anything.
 */
export async function verifyCheckoutSession(
  sessionId: string,
): Promise<StripeResult<{ verified: boolean; reason?: string }>> {
  const token = await getAuthToken();
  if (!token) return { ok: false, error: 'You must be signed in to confirm checkout' };

  try {
    const resp = await fetch('/api/checkout/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ session_id: sessionId }),
      // RT-06: a hung connection right after payment must not freeze the
      // verify spinner indefinitely.
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { ok: false, error: (body as { error?: string }).error || 'Could not confirm checkout' };
    }

    return { ok: true, data: (await resp.json()) as { verified: boolean; reason?: string } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function createBillingPortalSession(): Promise<StripeResult<{ url: string }>> {
  const token = await getAuthToken();
  if (!token) return { ok: false, error: 'You must be signed in to manage billing' };

  try {
    const resp = await fetch('/api/portal', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000), // RT-06
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { ok: false, error: (body as { error?: string }).error || 'Billing portal session creation failed' };
    }

    const data = (await resp.json()) as { url: string };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function changeSubscription(planId: string, billing: 'monthly' | 'annual'): Promise<StripeResult<{ success: boolean }>> {
  const token = await getAuthToken();
  if (!token) return { ok: false, error: 'You must be signed in to change your subscription' };

  try {
    const resp = await fetch('/api/subscription', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ planId, billing }),
      signal: AbortSignal.timeout(15000), // RT-06
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { ok: false, error: (body as { error?: string }).error || 'Subscription change failed' };
    }

    return { ok: true, data: { success: true } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function cancelSubscription(): Promise<StripeResult<{ success: boolean }>> {
  const token = await getAuthToken();
  if (!token) return { ok: false, error: 'You must be signed in to cancel your subscription' };

  try {
    const resp = await fetch('/api/subscription', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000), // RT-06
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { ok: false, error: (body as { error?: string }).error || 'Cancellation failed' };
    }

    return { ok: true, data: { success: true } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export type StripeEventType = 'checkout.session.completed' | 'customer.subscription.updated' | 'customer.subscription.deleted' | 'invoice.paid' | 'invoice.payment_failed';

export interface StripeWebhookEvent {
  id: string;
  type: StripeEventType;
  created: number;
  data: { object: Record<string, unknown> };
}

const WEBHOOK_HANDLERS: Record<StripeEventType, (data: Record<string, unknown>) => void> = {
  'checkout.session.completed': (data) => { void data; },
  'customer.subscription.updated': (data) => { void data; },
  'customer.subscription.deleted': (data) => { void data; },
  'invoice.paid': (data) => { void data; },
  'invoice.payment_failed': (data) => { void data; },
};

export function handleWebhookEvent(event: StripeWebhookEvent): void {
  const handler = WEBHOOK_HANDLERS[event.type];
  if (handler) {
    handler(event.data.object);
  }
}

export type { PriceConfig };
