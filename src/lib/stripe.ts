const STRIPE_PK = import.meta.env.VITE_STRIPE_PK;

if (!STRIPE_PK || STRIPE_PK === 'pk_test_placeholder') {
  console.warn('[Stripe] VITE_STRIPE_PK is not configured — billing features will be unavailable');
}

interface CheckoutParams {
  priceId: string;
  planId: string;
  billing: 'monthly' | 'annual';
  trial?: boolean | undefined;
}

const PRICE_IDS: Record<string, Record<'monthly' | 'annual', string>> = {
  starter: { monthly: 'price_starter_monthly', annual: 'price_starter_annual' },
  growth: { monthly: 'price_growth_monthly', annual: 'price_growth_annual' },
  pro: { monthly: 'price_pro_monthly', annual: 'price_pro_annual' },
};

type StripeResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function createCheckoutSession({ planId, billing, trial }: CheckoutParams): Promise<StripeResult<{ url: string }>> {
  const priceId = PRICE_IDS[planId]?.[billing];
  if (!priceId) return { ok: false, error: 'Invalid plan selection' };
  if (!STRIPE_PK) return { ok: false, error: 'Stripe is not configured' };

  try {
    const resp = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceId, planId, billing, trial }),
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

export async function createBillingPortalSession(): Promise<StripeResult<{ url: string }>> {
  if (!STRIPE_PK) return { ok: false, error: 'Stripe is not configured' };

  try {
    const resp = await fetch('/api/stripe/portal', { method: 'POST' });

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
  if (!STRIPE_PK) return { ok: false, error: 'Stripe is not configured' };

  try {
    const resp = await fetch('/api/stripe/subscription', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId, billing }),
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
  if (!STRIPE_PK) return { ok: false, error: 'Stripe is not configured' };

  try {
    const resp = await fetch('/api/stripe/subscription', { method: 'DELETE' });

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

export { STRIPE_PK, PRICE_IDS };