// P1-10 — claims register. Every quantitative or absolute marketing claim
// must have an owner, evidence, approved surfaces, and a review date.
// Review: each claim is re-verified by `review_due`. Do not surface a claim
// on a page that is not in its approved_surfaces list.
//
// CONVENTION: a claim is "approved" only when evidence has been reviewed.
// Unreviewed claims must use qualified wording ("supports", "maps to",
// "designed around") rather than absolutes ("compliant", "certified").
//
// ENFORCEMENT (audit F-A-15): tests/claims-honesty.test.ts fails when
//   - an 'unverified' claim lists an approved surface (unverified = unpublished),
//   - any `patterns` entry of an unverified claim appears on a public surface
//     (pages, index.html, llms.txt, route meta, FAQ data),
//   - any `forbidden_patterns` entry of ANY claim appears on a public surface
//     (the same list plus the Privacy, Terms and DPA pages), or
//   - a claim's `review_due` has passed.
// Withdrawing a claim means: status 'unverified', empty approved_surfaces, and
// `patterns` that match its old wording so it cannot creep back in new words.

import { dataFacts } from './data-facts';

export type Claim = {
  id: string;
  text: string;
  owner: string;
  evidence: string;
  approved_surfaces: string[];
  caveat?: string;
  /** Case-insensitive regex sources matching this claim's wording. Set on unverified/withdrawn claims. */
  patterns?: string[];
  /**
   * Case-insensitive regex sources for wording this claim must never be stretched into, on any public
   * surface and whatever the claim's status (a qualified claim has sentences it may not become).
   */
  forbidden_patterns?: string[];
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
    caveat: 'Alignment is not certification. Eco-Auditor is not affiliated with GHG Protocol/WRI. Say "aligned with", not "follows": the base year is stored and printed on reports (K5), but nothing recalculates against it, so there is no base-year recalculation policy. Scope 2 totals are location-based; a separate market-based total exists only for entries priced with the 2026-09-30 factor catalog (renewable contracts at zero, all other electricity at its grid factor because no residual-mix factor is applied), so do not say "market-based reporting".',
    // VF-1: the Security page said the methodology "follows" the standards; tests/claims-honesty.test.ts fails on it.
    forbidden_patterns: ['follows? (the )?(GHG|Greenhouse)'],
    reviewed_at: '2026-09-30',
    review_due: '2026-12-31',
    status: 'qualified',
  },
  {
    id: 'no-card-trial',
    text: '14-day free Starter trial · No card required',
    owner: 'Product + Billing',
    evidence: 'Signing up grants a 14-day trial with no payment method: server.cjs ensureCompanyForUser sets trial_ends_at on first API access, with no Stripe involvement. billingStateFromCompany (server-billing.cjs) maps an active trial to the Starter plan.',
    approved_surfaces: ['homepage', 'signup', 'methodology'],
    caveat: 'The card-free trial has Starter limits (Scope 1 & 2 only, 1 facility, 10 CSV imports per month; plan-limits.json): a Scope 3 row returns 402. Always name the tier; build the wording with trialHeadline()/trialLimitsLabel() in pricing.ts. Card-free only on the signup path: starting a trial from the pricing page creates a Stripe Checkout subscription, which collects a card. At trial end without a paid plan the dashboard, imports, reports and the calculator are paused in the app: those APIs return 402, and since K2 the calculator reads and writes entries through them (/api/entries). The data stays readable, not removed: Settings → Export my data is deliberately not plan-gated, deleting entries stays allowed, and the records API keeps SELECT for the owner. So say the app is paused and the data can still be exported; do not say access is removed or the data locked. Until docs/deferred-migrations/20260930130000_revoke-authenticated-writes.sql is applied the records API also still accepts direct writes from outside the app, so do not claim writes are blocked at the database. The free trial is offered once per company: checkout attaches none when the company\'s card-free trial has run out, when its own record shows a subscription, or when Stripe lists a past subscription for the customer (checkoutTrialDecision in server-billing.cjs), and Terms section 9 and the in-app pricing caption say so; do not promise a second trial. Owner decision pending on whether the trial should carry Growth limits.',
    reviewed_at: '2026-09-30',
    review_due: '2026-12-31',
    status: 'qualified',
  },
  {
    id: 'enterprise-grade',
    text: 'Enterprise-grade security',
    owner: 'Security + Legal',
    evidence: 'WITHDRAWN 2026-09-30 (audit F-C-18). The Security page pill graded the security as enterprise level with nothing behind it: no SOC 2 audit has been completed (trust-facts.ts soc2Status), the DPA lists no customer MFA, no penetration test and no tested restore, and alerting has no owner (LAUNCH_AUDIT OPS-001).',
    approved_surfaces: [],
    caveat: 'UNPUBLISHED. State what is true instead, in plain sentences: TLS in transit, row-level security and server-side tenant checks between workspaces, encryption at rest by the database provider. Re-approve only with an independent assessment on file.',
    patterns: ['enterprise[- ]grade'],
    reviewed_at: '2026-09-30',
    review_due: '2026-12-31',
    status: 'unverified',
  },
  {
    id: 'audit-ready',
    text: 'Audit-ready records',
    owner: 'Product + Methodology',
    evidence: 'WITHDRAWN 2026-09-30 (audit F-A-01, F-A-03). At the audit, entries did not record the factor source or version, manual rows stored the activity string in `factor`, CSV rows lost their import timestamp, and owners could UPDATE and DELETE rows with no history table: there was no audit trail, version history or reviewer attribution. K2 (2026-09-30): calculator entries saved through the server API (/api/entries) now store the activity, factor, dataset id and catalog version; K4 (2026-09-30): CSV rows imported from then on store the same, plus the import they came from (import_id), and keep created_at as the time they were stored. CSV rows imported earlier and older entries still do not. K5 (2026-09-30): an edit made through the server API (PATCH /api/entries/:id) records the editor\'s account ID, the time and the previous and new values in public.entry_history (append-only; the record is deleted with its entry, so a deleted entry leaves no history). Edits made directly through the records API, which accepts direct writes until the deferred REVOKE is applied, leave only updated_at, and there is still no reviewer attribution beyond the editor\'s account ID and no tamper-evident log, so the claim stays withdrawn.',
    approved_surfaces: [],
    caveat: 'UNPUBLISHED. Do not say "audit-ready", "verifiable audit trails", "versioned calculation logs" or "suitable for third-party assurance" until the entry history covers every write path (K5 records API edits only) and per-entry factor provenance exists for older entries. Say "PDF emissions summary and JSON export". Assurance is performed by an independent provider, not by software.',
    patterns: ['audit[- ]ready', 'verifiable audit trails?', 'versioned calculation logs?', 'suitable for third-party assurance'],
    reviewed_at: '2026-09-30',
    review_due: '2026-12-31',
    status: 'unverified',
  },
  {
    id: 'consultant-cost-comparison',
    text: 'Cheaper than a single consultant engagement',
    owner: 'Product Marketing',
    evidence: 'No source on file. The $15K–$40K figure was removed from the pricing page in FEW-04; the conclusion ("pays for itself") and the "consultant fees" line were still live until the F-A-15 honesty pass removed them from every surface.',
    approved_surfaces: [],
    caveat: 'UNPUBLISHED. The consultant fee range was a market estimate, not a sourced quote. Do not restore a price comparison with consulting engagements, or "pays for itself", without a citable source recorded here.',
    patterns: ['pays for itself', 'consultant fees', 'cheaper than (a|any|one) (single )?consult', 'instead of a scoped consulting', 'no consultant required', 'not the consultant'],
    reviewed_at: '2026-09-30',
    review_due: '2026-12-31',
    status: 'unverified',
  },
  {
    id: 'setup-time',
    text: 'Most teams are up and running quickly',
    owner: 'Product',
    evidence: 'No usability test on file yet.',
    approved_surfaces: [],
    caveat: 'UNPUBLISHED. Unsupported by a measured usability test. Do not restore time-to-value language ("in weeks, not months", "setup took two weeks") until a measurement is recorded here.',
    patterns: ['up and running quickly', 'weeks, not months', 'inventory in weeks', 'setup took', 'report ready in 3'],
    reviewed_at: '2026-09-30',
    review_due: '2026-12-31',
    status: 'unverified',
  },
  {
    id: 'no-proprietary-formats',
    text: 'No proprietary formats',
    owner: 'Product',
    evidence: `The generated report is a standard PDF (rendered by src/lib/reports/report-generator.cjs renderReportPdf and stored with the report when it is generated, K3) and customers can download a machine-readable JSON export of their company profile (name, industry, reporting basis and base year), facilities, emission entries (${dataFacts.export.columns.emissionEntries.join(', ')}), report records (details only, not the PDF or its snapshot) and the CSV import log (file name, rows, warnings, file hash, status, undo time) from Settings → Export my data (GET /api/account/export, DATA-005; entries from loadEmissionEntriesForExport; the lists come from src/content/data-facts.ts, which tests/export-claim-coupling.test.ts holds to the queries). Checked 2026-09-30 (K2, F-B-08; K4): entries saved through the calculator since the server entry API, and CSV rows imported since K4, carry the activity as entered, the factor applied, its dataset id, the catalog version, CO2e and the activity date (CSV rows also the import they came from); older calculator entries and CSV rows imported before K4 have those provenance columns empty (null). No leads, consent records, billing data or entry edit records are exported.`,
    approved_surfaces: ['sample-report', 'homepage'],
    caveat: 'JSON export of a customer\'s own data is implemented and self-serve. CSV export of customer data is not implemented — the only CSVs on the site are static fictional samples. Say "machine-readable JSON export", not CSV. Provenance (factor, dataset, catalog version) exists only for entries saved through the calculator since K2 and CSV rows imported since K4, not for older entries: check the field list before describing its contents.',
    reviewed_at: '2026-09-30',
    review_due: '2026-12-31',
    status: 'qualified',
  },
  {
    id: 'every-number-traceable',
    text: 'Every number traces back to a source',
    owner: 'Product + Methodology',
    evidence: 'WITHDRAWN 2026-09-30 (audit F-A-03). 31 of 82 factors (28 of 29 Scope 3 sources plus the 3 process-emission factors) were internal estimates that were not in registry.ts. K7 (2026-09-30 catalog): 13 of them now cite EPA GHG Emission Factors Hub 2025 or UK DESNZ 2026 rows; 18 of 92 factors remain internal estimates (spend-based Scope 3, purchased-goods mass factors, process emissions, remote commuting), now registered as internal-estimate in registry.ts and flagged provisional with the car-pool factor (19 provisional); every factorSource resolves in registry.ts; entries saved before the new catalog keep the 2026-07-24 factors until restated. manual rows store no factor source; no entry stores a factor version; neither the app nor the JSON export shows the factor. K2 (2026-09-30): calculator entries saved through /api/entries now store and show their factor, dataset id and catalog version (entry list and JSON export), and since K4 so do newly imported CSV rows; CSV rows imported earlier and older entries do not, and the internal estimates are unchanged, so the claim stays withdrawn.',
    approved_surfaces: [],
    caveat: 'UNPUBLISHED. Say what is true instead: fuel, electricity, travel, commuting, freight and waste factors come from the EPA GHG Emission Factors Hub and eGRID (US hotel stays from UK DESNZ), and spend-based Scope 3 and process-emission factors are Eco-Auditor internal estimates (see the methodology page). Re-approve only after each entry stores and shows its factor source and version. "Source" on an entry means the activity type, not a bill or invoice: there is no document upload or storage.',
    patterns: ['every number (in eco-auditor )?traces', 'traces back to (the )?(activity|a source)', 'activity → factor → published dataset', 'its published dataset', 'published dataset that factor came from'],
    reviewed_at: '2026-09-30',
    review_due: '2026-12-31',
    status: 'unverified',
  },
  {
    id: 'never-train-on-customer-data',
    text: 'We do not train AI models on customer data',
    owner: 'AI Engineering',
    evidence: 'trust-facts.ts contentUsedForModelTraining = false (verified). The sales chatbot answers from a fixed rules table with no language model, and the AI Carbon Assistant is not built.',
    approved_surfaces: ['homepage', 'security', 'privacy'],
    reviewed_at: '2026-09-30',
    review_due: '2026-12-31',
    status: 'approved',
  },
];

export function getClaim(id: string): Claim | undefined {
  return CLAIMS.find((c) => c.id === id);
}
