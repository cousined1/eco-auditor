// AF-1 — single source of truth for plan pricing. Canonical values for now
// are the CURRENT UI prices (sourced from src/data/mockData.ts:212-267). The
// JSON-LD builder (Pricing.tsx), the salesbot KB (server.cjs), and the
// plan-aware signup checkout must all consume this module so the site never
// shows three different price sets.
//
// LAUNCH-READINESS CHECKLIST (before publication):
//   1. Create the Stripe products/prices for Starter/Growth/Pro × monthly/annual.
//   2. Set the env vars named in each plan's priceIdEnv to the live Stripe price IDs.
//   3. Reconcile `monthly`/`annual` here against the live Stripe price amounts.
// `priceIdEnv` holds env var NAMES (strings), never the secret price ID values.
// Do NOT fabricate Stripe price IDs — they are resolved at runtime from env.
export type Billing = 'monthly' | 'annual';
export type PlanId = 'starter' | 'growth' | 'pro';

export type Plan = {
  id: PlanId;
  name: string;
  monthly: number; // USD per month, billed monthly
  annual: number; // USD per year, billed annually (2 months free vs monthly)
  priceIdEnv: { monthly: string; annual: string }; // env var NAMES, not secrets
  badge?: string;
  popular?: boolean;
  trial: boolean;
  features: string[];
  locked: string[];
};

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    monthly: 149,
    annual: 1490,
    priceIdEnv: { monthly: 'STRIPE_PRICE_STARTER_MONTHLY', annual: 'STRIPE_PRICE_STARTER_ANNUAL' },
    badge: 'Best for first compliance workflow',
    trial: true,
    features: [
      '1 company',
      '1 facility',
      'Baseline Scope 1 & 2 tracking',
      'Limited document uploads (10/month)',
      '1 reporting template',
      'Email support',
    ],
    locked: ['Scope 3 workflows', 'AI Carbon Assistant', 'Supplier request hub', 'Integrations', 'Audit trail exports'],
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    monthly: 399,
    annual: 3990,
    priceIdEnv: { monthly: 'STRIPE_PRICE_GROWTH_MONTHLY', annual: 'STRIPE_PRICE_GROWTH_ANNUAL' },
    badge: 'Most popular',
    popular: true,
    trial: true,
    features: [
      'Up to 5 facilities',
      'Scope 1, 2, & key Scope 3 workflows',
      'QuickBooks & Xero integrations',
      'AI Carbon Assistant',
      'Supplier request hub',
      'Audit trail & report exports',
      'Priority support',
    ],
    locked: ['Multi-entity', 'Custom reporting', 'Team permissions', 'API access'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthly: 999,
    annual: 9990,
    priceIdEnv: { monthly: 'STRIPE_PRICE_PRO_MONTHLY', annual: 'STRIPE_PRICE_PRO_ANNUAL' },
    badge: 'Best for multi-facility teams',
    trial: false,
    features: [
      'Multi-entity & advanced workflows',
      'Advanced audit ledger',
      'Approval workflows',
      'Custom reporting templates',
      'Team permissions & roles',
      'Premium support & onboarding',
      'API & advanced integrations',
    ],
    locked: [],
  },
};

export function getPlanById(id: string): Plan | undefined {
  return PLANS[id as PlanId];
}

export function resolvePriceId(plan: Plan, billing: Billing): string | undefined {
  return process.env[plan.priceIdEnv[billing]];
}