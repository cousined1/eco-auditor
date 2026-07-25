// P1-10 — claims register. Every quantitative or absolute marketing claim
// must have an owner, evidence, approved surfaces, and a review date.
// Review: each claim is re-verified by `review_due`. Do not surface a claim
// on a page that is not in its approved_surfaces list.
//
// CONVENTION: a claim is "approved" only when evidence has been reviewed.
// Unreviewed claims must use qualified wording ("supports", "maps to",
// "designed around") rather than absolutes ("compliant", "certified").

export type Claim = {
  id: string;
  text: string;
  owner: string;
  evidence: string;
  approved_surfaces: string[];
  caveat?: string;
  reviewed_at: string;
  review_due: string;
  status: 'approved' | 'qualified' | 'unverified';
};

export const CLAIMS: Claim[] = [
  {
    id: 'ghg-protocol-aligned',
    text: 'GHG Protocol aligned',
    owner: 'Methodology',
    evidence: 'MethodologyPublic.tsx maps Scope 1/2 to the Corporate Standard and Scope 3 to the Corporate Value Chain Standard.',
    approved_surfaces: ['homepage', 'pricing', 'methodology', 'sample-report'],
    caveat: 'Alignment is not certification. Eco-Auditor is not affiliated with GHG Protocol/WRI.',
    reviewed_at: '2026-07-15',
    review_due: '2026-10-15',
    status: 'qualified',
  },
  {
    id: 'no-card-trial',
    text: '14-day free trial · No card required',
    owner: 'Product + Billing',
    evidence: 'Signing up grants a 14-day trial with no payment method: server.cjs ensureCompanyForUser sets trial_ends_at on first API access, with no Stripe involvement.',
    approved_surfaces: ['homepage', 'signup'],
    caveat: 'Card-free only on the signup path. Starting a trial from the pricing page creates a Stripe Checkout subscription, which collects a card. At trial end without a paid plan, dashboard and calculation APIs return 402 — access is paused, not read-only.',
    reviewed_at: '2026-07-24',
    review_due: '2026-10-15',
    status: 'qualified',
  },
  {
    id: 'audit-ready',
    text: 'Audit-ready records',
    owner: 'Product + Methodology',
    evidence: 'Each entry records activity type, amount, unit, the emission factor applied, calculation method, a confidence score, and a timestamp (emission_entries schema).',
    approved_surfaces: ['homepage', 'pricing', 'sample-report'],
    caveat: 'No reviewer attribution and no source-document storage — the schema has neither column. Does not constitute independent assurance or guarantee an audit outcome.',
    reviewed_at: '2026-07-24',
    review_due: '2026-10-15',
    status: 'qualified',
  },
  {
    id: 'consultant-cost-comparison',
    text: 'Cheaper than a single consultant engagement',
    owner: 'Product Marketing',
    evidence: 'Pricing.tsx: $15K–$40K typical consultant fee vs $3,990/year Growth plan.',
    approved_surfaces: ['pricing'],
    caveat: 'Consultant fee range is a market estimate, not a sourced quote. Remove if a defensible source cannot be cited.',
    reviewed_at: '2026-07-15',
    review_due: '2026-08-15',
    status: 'unverified',
  },
  {
    id: 'setup-time',
    text: 'Most teams are up and running quickly',
    owner: 'Product',
    evidence: 'No usability test on file yet.',
    approved_surfaces: ['homepage', 'signup'],
    caveat: 'Unsupported by a measured usability test. Replace with a measured claim or remove the time-to-value language.',
    reviewed_at: '2026-07-15',
    review_due: '2026-08-15',
    status: 'unverified',
  },
  {
    id: 'no-proprietary-formats',
    text: 'No proprietary formats',
    owner: 'Product',
    evidence: 'The generated report is a standard PDF (server.cjs createSimplePdf). Nothing is emitted in a proprietary format.',
    approved_surfaces: ['sample-report', 'homepage'],
    caveat: 'Ledger/CSV export of a customer\'s own data is not implemented — the only CSVs on the site are static fictional samples. Do not claim CSV export until an export endpoint exists.',
    reviewed_at: '2026-07-24',
    review_due: '2026-10-15',
    status: 'qualified',
  },
  {
    id: 'every-number-traceable',
    text: 'Every number traces back to a source',
    owner: 'Product + Methodology',
    evidence: 'Every factor in emission-factors.json carries a factorSource id resolving to a publisher, version, and year in registry.ts, and each entry stores the factor applied plus a timestamp.',
    approved_surfaces: ['homepage', 'sample-report', 'methodology'],
    caveat: 'Traces to the emission factor and its published dataset, not to a source document — there is no document upload or storage. "Source" on an entry means the activity type (e.g. Natural Gas), not a bill or invoice.',
    reviewed_at: '2026-07-24',
    review_due: '2026-10-15',
    status: 'qualified',
  },
  {
    id: 'never-train-on-customer-data',
    text: 'We do not train AI models on customer data',
    owner: 'AI Engineering',
    evidence: 'trust-facts.ts contentUsedForModelTraining = false (verified). AI assistant uses user prompts for in-session responses only.',
    approved_surfaces: ['homepage', 'security', 'privacy'],
    reviewed_at: '2026-07-15',
    review_due: '2026-10-15',
    status: 'approved',
  },
];

export function getClaim(id: string): Claim | undefined {
  return CLAIMS.find((c) => c.id === id);
}