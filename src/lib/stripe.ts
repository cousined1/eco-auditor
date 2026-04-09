const STRIPE_PK = import.meta.env.VITE_STRIPE_PK || 'pk_test_placeholder';

interface CheckoutParams {
  priceId: string;
  planId: string;
  billing: 'monthly' | 'annual';
  trial?: boolean;
}

const PRICE_IDS: Record<string, Record<'monthly' | 'annual', string>> = {
  starter: { monthly: 'price_starter_monthly', annual: 'price_starter_annual' },
  growth: { monthly: 'price_growth_monthly', annual: 'price_growth_annual' },
  pro: { monthly: 'price_pro_monthly', annual: 'price_pro_annual' },
};

export async function createCheckoutSession({ planId, billing, trial }: CheckoutParams): Promise<{ url: string } | { error: string }> {
  const priceId = PRICE_IDS[planId]?.[billing];
  if (!priceId) return { error: 'Invalid plan selection' };

  console.log('[Stripe] Creating checkout session:', { priceId, planId, billing, trial, pk: STRIPE_PK });

  return { url: `${window.location.origin}/settings?checkout=success&plan=${planId}` };
}

export async function createBillingPortalSession(): Promise<{ url: string } | { error: string }> {
  console.log('[Stripe] Creating billing portal session');
  return { url: `${window.location.origin}/settings?portal=return` };
}

export async function changeSubscription(planId: string, billing: 'monthly' | 'annual'): Promise<{ success: boolean } | { error: string }> {
  console.log('[Stripe] Changing subscription:', { planId, billing });
  return { success: true };
}

export async function cancelSubscription(): Promise<{ success: boolean } | { error: string }> {
  console.log('[Stripe] Canceling subscription');
  return { success: true };
}

export type StripeEventType = 'checkout.session.completed' | 'customer.subscription.updated' | 'customer.subscription.deleted' | 'invoice.paid' | 'invoice.payment_failed';

export interface StripeWebhookEvent {
  id: string;
  type: StripeEventType;
  created: number;
  data: { object: Record<string, unknown> };
}

const WEBHOOK_HANDLERS: Record<StripeEventType, (data: Record<string, unknown>) => void> = {
  'checkout.session.completed': (data) => {
    console.log('[Webhook] Checkout completed:', data);
  },
  'customer.subscription.updated': (data) => {
    console.log('[Webhook] Subscription updated:', data);
  },
  'customer.subscription.deleted': (data) => {
    console.log('[Webhook] Subscription deleted:', data);
  },
  'invoice.paid': (data) => {
    console.log('[Webhook] Invoice paid:', data);
  },
  'invoice.payment_failed': (data) => {
    console.log('[Webhook] Invoice payment failed:', data);
  },
};

export function handleWebhookEvent(event: StripeWebhookEvent): void {
  const handler = WEBHOOK_HANDLERS[event.type];
  if (handler) {
    handler(event.data.object);
  } else {
    console.warn('[Webhook] Unhandled event type:', event.type);
  }
}

export { STRIPE_PK, PRICE_IDS };