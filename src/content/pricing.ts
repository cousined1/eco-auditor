// AF-1 — single source of truth for plan pricing. Canonical values for now
// are the CURRENT UI prices. The JSON-LD builder (Pricing.tsx), the salesbot KB
// (server.cjs), and the plan-aware signup checkout must all consume this module
// so the site never shows three different price sets.
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

export type RoadmapItem = {
  feature: string;
  /** Plans the feature is planned for. Every other plan shows "—" in the comparison table. */
  tiers: readonly PlanId[];
};

// F-A-10 / F-C-11 — the ONE list of unshipped features. The "On the roadmap"
// bullets on each plan card and the "Roadmap" cells of the comparison table are
// both derived from it; they used to be typed twice and disagreed (the Starter
// card listed four roadmap items the table marked "—"). The plan a feature is
// listed under is a product decision: a card can never promise a roadmap item
// the table does not show for that plan, because both read this array.
export const ROADMAP: readonly RoadmapItem[] = [
  { feature: 'AI Carbon Assistant', tiers: ['growth', 'pro'] },
  { feature: 'Supplier request hub', tiers: ['growth', 'pro'] },
  { feature: 'QuickBooks / Xero integrations', tiers: ['growth', 'pro'] },
  { feature: 'UPS / FedEx connectors', tiers: ['growth', 'pro'] },
  { feature: 'Audit trail & exports', tiers: ['growth', 'pro'] },
  { feature: 'Approval workflows', tiers: ['pro'] },
  { feature: 'Team permissions', tiers: ['pro'] },
  { feature: 'Multi-entity support', tiers: ['pro'] },
  { feature: 'API access', tiers: ['pro'] },
  { feature: 'Custom report templates', tiers: ['pro'] },
];

function roadmapFor(id: PlanId): string[] {
  return ROADMAP.filter((item) => item.tiers.includes(id)).map((item) => item.feature);
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
  roadmap: string[]; // unshipped features planned for this tier (derived from ROADMAP)
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
    locked: [facilitiesLabel('growth'), 'Scope 3 workflows', 'Priority support'],
    roadmap: roadmapFor('starter'),
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    monthly: 399,
    annual: 3990,
    priceIdEnv: { monthly: 'STRIPE_PRICE_GROWTH_MONTHLY', annual: 'STRIPE_PRICE_GROWTH_ANNUAL' },
    // The previous badge implied a customer base the product does not have (F-C-18).
    badge: 'Recommended',
    popular: true,
    trial: true,
    features: [
      facilitiesLabel('growth'),
      scope3Label('growth'),
      importsLabel('growth'),
      'PDF emissions summary',
      'Priority support',
    ],
    locked: [facilitiesLabel('pro'), 'Premium support & onboarding'],
    roadmap: roadmapFor('growth'),
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
    roadmap: roadmapFor('pro'),
  },
};

// F-A-09 — what the CARD-FREE trial actually is. Signing up without a plan sets
// trial_ends_at, and billingStateFromCompany (server-billing.cjs) maps an active
// trial to plan 'starter': Scope 3 rows return 402, one facility, ten CSV
// imports a month. Every surface that mentions the card-free trial must say so;
// build the wording from here so it follows plan-limits.json. (This is separate
// from the card-collecting Stripe trial on monthly Starter/Growth checkout.)
// Pending an owner decision on whether the trial should carry Growth limits.
export const TRIAL_DAYS = 14;
export const TRIAL_PLAN_ID: PlanId = 'starter';

/** "14-day free Starter trial" */
export function trialHeadline(): string {
  return `${TRIAL_DAYS}-day free ${PLANS[TRIAL_PLAN_ID].name} trial`;
}

/** "Scope 1 & 2 only, 1 facility, 10 CSV imports per month" */
export function trialLimitsLabel(): string {
  const limits = PLAN_LIMITS[TRIAL_PLAN_ID];
  return [
    limits.scope3 ? 'Scope 1, 2 & 3' : 'Scope 1 & 2 only',
    facilitiesLabel(TRIAL_PLAN_ID),
    importsLabel(TRIAL_PLAN_ID),
  ].join(', ');
}

export type AddOn = { id: string; name: string; price: number; unit: string };

// Only add-ons whose feature exists. The supplier-request and extra-template
// packs were removed (F-A-10): both were priced for roadmap features.
// tests/claims-honesty.test.ts fails if an add-on is named after a roadmap item.
export const ADD_ONS: readonly AddOn[] = [
  { id: 'extra-facility', name: 'Extra facility', price: 49, unit: '/month' },
  { id: 'implementation', name: 'Guided setup & data mapping', price: 1500, unit: ' one-time' },
];

export type ComparisonRow = { feature: string; starter: string; growth: string; pro: string };

// The four rows the server actually enforces are derived from plan-limits.json,
// so this table cannot advertise a cap the API does not apply. Roadmap rows come
// from ROADMAP.
const limitCell = (value: number | null) => (value === null ? 'Unlimited' : String(value));
const importsCell = (id: PlanId) => {
  const limit = PLAN_LIMITS[id].csvImportsPerMonth;
  return limit === null ? 'Unlimited' : `${limit}/mo`;
};
const scope3Cell = (id: PlanId) => (PLAN_LIMITS[id].scope3 ? '✓' : '—');
const roadmapCell = (item: RoadmapItem, id: PlanId) => (item.tiers.includes(id) ? 'Roadmap' : '—');

export const FEATURE_COMPARISON: readonly ComparisonRow[] = [
  // Multi-company does not exist yet — every account has exactly one, on every
  // plan. Do not restore "Unlimited" for Pro until it is built and enforced.
  { feature: 'Companies', starter: '1', growth: '1', pro: '1' },
  {
    feature: 'Facilities',
    starter: limitCell(PLAN_LIMITS.starter.facilities),
    growth: limitCell(PLAN_LIMITS.growth.facilities),
    pro: limitCell(PLAN_LIMITS.pro.facilities),
  },
  { feature: 'Scope 1 tracking', starter: '✓', growth: '✓', pro: '✓' },
  { feature: 'Scope 2 tracking', starter: '✓', growth: '✓', pro: '✓' },
  { feature: 'Scope 3 workflows', starter: scope3Cell('starter'), growth: scope3Cell('growth'), pro: scope3Cell('pro') },
  { feature: 'CSV imports', starter: importsCell('starter'), growth: importsCell('growth'), pro: importsCell('pro') },
  // Exactly one report template exists, for everyone. Tiered templates are
  // roadmap; see the audit's P0-5 note.
  { feature: 'Reporting templates', starter: '1', growth: '1', pro: '1' },
  ...ROADMAP.map((item) => ({
    feature: item.feature,
    starter: roadmapCell(item, 'starter'),
    growth: roadmapCell(item, 'growth'),
    pro: roadmapCell(item, 'pro'),
  })),
  { feature: 'Support', starter: 'Email', growth: 'Priority', pro: 'Premium + onboarding' },
  // Stripe-checkout trial on monthly billing (a card is collected at checkout).
  { feature: 'Free trial (monthly billing)', starter: `${TRIAL_DAYS} days`, growth: `${TRIAL_DAYS} days`, pro: '—' },
];

// resolvePriceId() was removed: it read process.env in browser code, where Vite
// does not define `process`, so calling it would have thrown. It had no callers.
// Price IDs are resolved server-side and validated against an allowlist —
// GET /api/config/prices (server.cjs) feeding fetchPriceConfig() in lib/stripe.ts.
// Do not reintroduce client-side price resolution; it is what lets a client
// inject an arbitrary price into checkout.
