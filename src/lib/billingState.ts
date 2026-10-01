import { apiFetch } from './api';

// The caller's billing state as GET /api/billing returns it (server-billing.cjs
// billingStateFromCompany). The two trial fields are optional because the
// "company not provisioned yet" reply does not carry them.
export interface BillingState {
  active: boolean;
  plan: 'starter' | 'growth' | 'pro' | null;
  status: string | null;
  trialActive: boolean;
  trialEndsAt: string | null;
  /** Nothing is active, the card-free trial ran out and nothing was ever bought. */
  trialEnded?: boolean | undefined;
  /** Whether checkout may still attach a free trial. The server decides at checkout regardless. */
  trialEligible?: boolean | undefined;
  currentPeriodEnd: string | null;
  billingCycle: 'monthly' | 'annual' | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  /** Where the server got it: 'db', or 'pending' (no company row yet). Without a database the route answers 503. */
  source?: string | undefined;
}

function isBillingState(value: unknown): value is BillingState {
  return typeof value === 'object' && value !== null && typeof (value as { active?: unknown }).active === 'boolean';
}

/**
 * The signed-in user's billing state, or null when it cannot be had (signed out,
 * offline, server error). Callers show nothing rather than a guess.
 */
export async function fetchBillingState(): Promise<BillingState | null> {
  try {
    const res = await apiFetch('/api/billing', { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isBillingState(body) ? body : null;
  } catch {
    return null;
  }
}

// Something changed the subscription (a checkout was confirmed): whoever shows the
// billing state reloads it instead of waiting for the next page view.
const BILLING_CHANGED = 'eco-auditor:billing-changed';

export function notifyBillingChanged(): void {
  window.dispatchEvent(new Event(BILLING_CHANGED));
}

export function onBillingChanged(handler: () => void): () => void {
  window.addEventListener(BILLING_CHANGED, handler);
  return () => window.removeEventListener(BILLING_CHANGED, handler);
}
