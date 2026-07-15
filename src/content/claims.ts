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
    evidence: 'server.cjs TRIAL_ELIGIBLE_PLANS honors trials on monthly billing without requiring a payment method at signup.',
    approved_surfaces: ['homepage', 'pricing', 'signup', 'methodology'],
    caveat: 'Trial available on monthly plans only. Workspace becomes read-only at trial end unless a paid plan is selected.',
    reviewed_at: '2026-07-15',
    review_due: '2026-10-15',
    status: 'approved',
  },
  {
    id: 'audit-ready',
    text: 'Audit-ready records',
    owner: 'Product + Methodology',
    evidence: 'Emissions ledger records source, emission factor, reviewer, and timestamp per entry.',
    approved_surfaces: ['homepage', 'pricing', 'sample-report'],
    caveat: 'Does not constitute independent assurance or guarantee an audit outcome.',
    reviewed_at: '2026-07-15',
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
    evidence: 'Reports export as PDF and CSV; ledger is a standard CSV.',
    approved_surfaces: ['sample-report', 'homepage'],
    reviewed_at: '2026-07-15',
    review_due: '2026-10-15',
    status: 'approved',
  },
  {
    id: 'every-number-traceable',
    text: 'Every number traces back to a source',
    owner: 'Product + Methodology',
    evidence: 'Ledger records source document, emission factor, reviewer, and timestamp per entry.',
    approved_surfaces: ['homepage', 'sample-report', 'methodology'],
    caveat: 'Traceability depends on the user uploading source records; estimated rows reference factor datasets, not a primary source.',
    reviewed_at: '2026-07-15',
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