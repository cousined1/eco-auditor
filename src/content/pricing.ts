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
import planLimitsFile from '../../plan-limits.json';

export type Billing = 'monthly' | 'annual';
export type PlanId = 'starter' | 'growth' | 'pro';

export type PlanLimits = {
  facilities: number | null; // null = unlimited
  csvImportsPerMonth: number | null;
  scope3: boolean;
};

/**
 * The same limits the server enforces (server-billing.cjs reads this file too).
 * Every limit advertised below is derived from here, so the pricing page cannot
 * promise a cap the API does not apply — which is exactly what it used to do.
 */
export const PLAN_LIMITS = planLimitsFile.plans as Record<PlanId, PlanLimits>;

const countLabel = (value: number | null, singular: string, plural = `${singular}s`) =>
  value === null ? `Unlimited ${plural}` : `${value} ${value === 1 ? singular : plural}`;

function facilitiesLabel(id: PlanId): string {
  return countLabel(PLAN_LIMITS[id].facilities, 'facility', 'facilities');
}

function importsLabel(id: PlanId): string {
  const limit = PLAN_LIMITS[id].csvImportsPerMonth;
  return limit === null ? 'Unlimited CSV imports' : `${limit} CSV imports per month`;
}

function scope3Label(id: PlanId): string {
  return PLAN_LIMITS[id].scope3 ? 'Scope 1, 2 & 3 workflows' : 'Scope 1 & 2 workflows';
}

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
  locked: string[]; // features not included in this tier (live in higher tiers)
  roadmap: string[]; // unshipped features planned for this tier
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
      facilitiesLabel('starter'),
      scope3Label('starter'),
      importsLabel('starter'),
      'PDF emissions summary',
      'Email support',
    ],
    locked: ['Scope 3 workflows', 'Priority support'],
    roadmap: ['AI Carbon Assistant', 'Supplier request hub', 'QuickBooks & Xero integrations', 'Audit trail & exports'],
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
      facilitiesLabel('growth'),
      scope3Label('growth'),
      importsLabel('growth'),
      'PDF emissions summary',
      'Priority support',
    ],
    locked: ['Premium support & onboarding'],
    roadmap: ['AI Carbon Assistant', 'Supplier request hub', 'QuickBooks & Xero integrations', 'Audit trail & report exports', 'Team permissions', 'API access'],
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
      facilitiesLabel('pro'),
      scope3Label('pro'),
      importsLabel('pro'),
      'PDF emissions summary',
      'Premium support & onboarding',
    ],
    locked: [],
    roadmap: ['Advanced audit ledger', 'Approval workflows', 'Custom reporting templates', 'Team permissions & roles', 'API & advanced integrations'],
  },
};

// resolvePriceId() was removed: it read process.env in browser code, where Vite
// does not define `process`, so calling it would have thrown. It had no callers.
// Price IDs are resolved server-side and validated against an allowlist —
// GET /api/config/prices (server.cjs) feeding fetchPriceConfig() in lib/stripe.ts.
// Do not reintroduce client-side price resolution; it is what lets a client
// inject an arbitrary price into checkout.