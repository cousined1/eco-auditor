# Eco-Auditor P0 Fix Plan — fusion-3 panelist (opus)

Grounded, file-by-file plan. Every file:line claim in the brief was verified
against the repo on 2026-07-11. Corrections are listed in §"Brief corrections"
and inline as `(CORRECTION …)`. No repo source files were edited.

Stack verified from `package.json`: react ^19.2.4, react-router-dom ^7.14.0,
typescript ~6.0.2, tailwindcss **3.4** (locked), express ^4.22.1, drizzle-orm
^0.45.2, pg ^8.20.0, @insforge/sdk ^1.2.4, stripe ^22.0.1, recharts ^3.8.1,
vite ^8.0.4, vitest ^4.1.4, eslint ^9.39.4. `build` = `tsc -b && vite build &&
node scripts/prerender.mjs` (`package.json:11`). Vitest include =
`tests/**/*.test.{ts,tsx}` (vitest.config). `@/*` → `./src/*` (tsconfig.app).

EPA/eGRID versions verified via EPA.gov (2026-07-11):
- eGRID2023 is the latest **official EPA** release (data year 2023, released
  2025-01-15, rev2 2025-06-12). **eGRID2024 has NOT been released by EPA**
  (EPA pages last updated 2026-05-20 still list eGRID2024 as "next planned").
  A third-party Cornerstone eGRID2024 interim dataset exists (Zenodo
  10.5281/zenodo.20403776) and Climate Action Reserve adopted it
  (policy memo 2026-05-14) — NOT an EPA release.
- EPA GHG Emission Factors Hub: latest official is the **2025 EFH**
  (released 2025-01, incorporates eGRID2023, data year 2024).
- Sources: https://www.epa.gov/egrid/detailed-data ,
  https://www.epa.gov/egrid/summary-data ,
  https://www.epa.gov/climateleadership/ghg-emission-factors-hub ,
  https://doi.org/10.5281/zenodo.20403776 ,
  https://climateactionreserve.org/wp-content/uploads/2026/05/2026-Interim-eGRID2024-Data.pdf

---

## P0-01 — /login and /signup prerender + SPA fallback

**Verified:** `scripts/prerender.mjs:37-47` ROUTES array excludes `/login`
and `/signup` (comment :34-36 says app routes excluded, but these are public
auth). `server.cjs:1523-1526` PRERENDERED_ROUTES = pricing/methodology/
sample-report/security/contact/privacy/terms/dpa — auth excluded; comment
:1520-1522 *explicitly* says "/login, /signup, /auth/* fall through to the
client-side shell". `server.cjs:1542-1545` SPA fallback sends
`static/index.html` (homepage prerender) for every unmatched route → non-JS
client hitting /login or /signup gets homepage HTML. Router wiring correct:
`App.tsx:275-276` (`/signup`→Signup, `/login`→Login). Login h1 = "Sign in to
Eco-Auditor" (`Login.tsx:72`); Signup h1 = "Start your free trial"
(`Signup.tsx:123`). Both are self-contained (InsForge only in event handlers)
so SSR render works. robots.txt **already** `Disallow: /login` and
`Disallow: /auth/`; does NOT disallow `/signup` (CORRECTION: brief implies
both need adding; only `/signup` is missing). sitemap.xml already excludes
both.

**Files:**
- `scripts/prerender.mjs:37-47` (ROUTES), `:92-115` (render loop), `:99`
  (template replace).
- `server.cjs:1523-1526` (PRERENDERED_ROUTES).
- `public/robots.txt` (add `/signup`).
- `src/pages/Login.tsx` (add useEffect noindex guard), `src/pages/Signup.tsx`
  (same).
- `src/pages/Signup.tsx:1,11-19,21-47` (plan-aware signup).

**Change:**
1. `scripts/prerender.mjs` — extend ROUTES:
   ```js
   const ROUTES = [
     '/', '/pricing', '/methodology', '/sample-report', '/security',
     '/contact', '/privacy', '/terms', '/dpa',
     '/login', '/signup',
   ];
   const NOINDEX_ROUTES = new Set(['/login', '/signup']);
   ```
   In the render loop, after building `out`, inject noindex meta into `<head>`:
   ```js
   let out = templateHtml.replace('<div id="root"></div>', `<div id="root">${html}</div>`);
   if (NOINDEX_ROUTES.has(route)) {
     out = out.replace('</head>',
       '<meta name="robots" content="noindex,nofollow"></head>');
   }
   ```
   (Place before the `if (route === '/')` write.)
2. `server.cjs:1523-1526` — add `/login` and `/signup` to PRERENDERED_ROUTES
   so they map to their own static file **before** the SPA fallback:
   ```js
   var PRERENDERED_ROUTES = [
     '/pricing', '/methodology', '/sample-report', '/security',
     '/contact', '/privacy', '/terms', '/dpa',
     '/login', '/signup',
   ];
   ```
   The existing `:1527-1539` per-route handler already serves
   `static/<route>/index.html` if it exists. Remove `/login, /signup` from the
   comment at :1520-1522 (now prerendered).
3. `public/robots.txt` — add `Disallow: /signup` under the existing
   `Disallow: /login`.
4. `src/pages/Login.tsx` / `src/pages/Signup.tsx` — add a useEffect that sets
   `<meta name="robots" content="noindex,nofollow">` client-side for the
   hydrated path and removes it on unmount (defensive; prerendered HTML
   already has it for crawlers).
5. Plan-aware signup (`Signup.tsx`): import `useSearchParams`; read
   `?plan=starter|growth|pro&billing=monthly|annual&source=pricing`; after
   `insforge.auth.signUp` succeeds and `data?.accessToken` is present, instead
   of `navigate('/app', …)`, if a plan param exists, navigate to
   `/app?checkout=${plan}_${billing}` (or redirect to `/api/checkout` via
   `createCheckoutSession`). No new InsForge SDK surface — uses existing
   `insforge.auth.signUp` (per hard constraint #6, no SDK change).

**Risk:** SSR render of /login,/signup could fail if any top-level import
touches `window`/InsForge — verified safe (entry-server.tsx comment :9-12;
auth components only call InsForge in handlers). Noindex must not leak into
hydrated client (useEffect cleanup). Sitemap/robots must stay consistent.

**Failable check:**
- `node scripts/prerender.mjs` exits 0 and logs `✓ /login` and `✓ /signup`.
- `grep -l "noindex" static/login/index.html static/signup/index.html` → both
  match.
- `grep -ci "sign in to eco-auditor" static/login/index.html` ≥ 1 and
  `grep -ci "start your free trial" static/signup/index.html` ≥ 1.
- `grep -ci "Start your free trial" static/login/index.html` (homepage hero
  copy) = 0 for /login; `grep -ci "Carbon accounting" static/signup/index.html`
  = 0 for /signup.
- `curl -s $URL/login | grep -i "sign in"` returns the auth h1, not homepage.
- New test `tests/routes-prerender.spec.ts` asserting `static/login/index.html`
  contains `noindex` and the auth h1 and does NOT contain the homepage hero.

---

## P0-02 — Legal placeholders: CI launch-gate guardrail

**Verified:** All placeholders confirmed:
- `TermsOfService.tsx:49` "Last updated: [Date to be set upon legal review]";
  `:166` "[AMOUNT TO BE SET UPON LEGAL REVIEW]"; `:186` "[Jurisdiction to be
  set upon legal review]"; `:187` "[Dispute resolution mechanism to be set
  upon legal review — e.g., arbitration, mediation, or courts of specified
  jurisdiction]"; `:45` "business draft for review" banner.
- `PrivacyPolicy.tsx:53` banner (text at :53), `:58` "[Date to be set…]".
- `DataProcessingAddendum.tsx:46` banner, `:50` "[Date to be set…]", `:281`
  "shall be completed upon execution".
- Operator entity verified named: "Developer312, a subsidiary of NIGHT LITE
  USA LLC" (`TermsOfService.tsx:57`, `PrivacyPolicy.tsx:67`, DPA `:181`).
- Good qualified language present: `TermsOfService.tsx:149,182`;
  `DataProcessingAddendum.tsx:54` "GDPR-aligned".

**Files:**
- `scripts/check-legal-placeholders.mjs` (new).
- `package.json:11` (build script).

**Change:** Create `scripts/check-legal-placeholders.mjs`:
```js
import fs from 'node:fs';
import path from 'node:path';
const FILES = ['TermsOfService', 'PrivacyPolicy', 'DataProcessingAddendum']
  .map(n => path.resolve('src/pages', `${n}.tsx`));
const BANNED = [
  '[Date to be set', '[AMOUNT TO BE SET', '[Jurisdiction to be set',
  '[Dispute resolution mechanism', 'business draft for review',
  '[PLACEHOLDER]', 'TBD', 'to be set upon legal review',
];
let bad = 0;
for (const f of FILES) {
  const txt = fs.readFileSync(f, 'utf8');
  for (const phrase of BANNED) {
    if (txt.includes(phrase)) {
      console.error(`[legal-placeholders] ${path.relative('.', f)}: "${phrase}"`);
      bad += 1;
    }
  }
}
if (bad > 0) { console.error(`\n${bad} placeholder(s) block launch. Replace before publication.`); process.exit(1); }
console.log('[legal-placeholders] no banned placeholders.');
```
Wire into build **before** `vite build` (`package.json:11`):
```json
"build": "tsc -b && node scripts/check-legal-placeholders.mjs && vite build && node scripts/prerender.mjs"
```
Per hard constraint #1: do NOT invent legal values. Placeholders stay until
counsel sign-off; the guardrail is a launch gate — `npm run build` FAILS while
any bracketed placeholder remains. Add `tests/legal-placeholders.test.ts`
wrapping the script so vitest also enforces it.

**Risk:** Build fails today (placeholders present) — intended. Must be
documented in launch-readiness checklist so counsel's replacement unblocks
the build. The "business draft for review" banners are NOT in the banned list
(intentional pre-launch labeling) — keep them.

**Failable check:** `node scripts/check-legal-placeholders.mjs; echo $?` →
non-zero today; `npx vitest run tests/legal-placeholders.test.ts` fails today;
after counsel replaces all bracketed tokens, both pass.

---

## P0-03 — Sample report 83% math bug

**Verified:** `SampleReport.tsx:149` "83% of total emissions backed by primary
source data or better. 17% flagged for improvement." `QUALITY_SCORES`
(`:20-25`): L1=8, L2=34, L3=41, L4-L5=17. L1+L2=42 (true primary-or-better);
83% = L1+L2+L3 (wrongly includes Industry Average L3); 17% estimated (L4+L5,
correct).

**Files:**
- `src/lib/reports/quality-summary.ts` (new).
- `src/lib/reports/quality-summary.test.ts` (new, or `tests/quality-summary.test.ts`).
- `src/pages/SampleReport.tsx:20-25,148-150`.

**Change:** Create `src/lib/reports/quality-summary.ts`:
```ts
export type QualityScore = { label: string; score: number; color?: string };
export type QualitySummary = {
  primaryOrBetter: number;       // L1 + L2
  industryAverageOrBetter: number; // L1 + L2 + L3
  estimated: number;             // L4 + L5 (remaining)
  total: number;
};
export function summarizeQuality(scores: QualityScore[]): QualitySummary {
  const byTier = (i: number) => scores[i]?.score ?? 0;
  const primaryOrBetter = (scores[0]?.score ?? 0) + (scores[1]?.score ?? 0);
  const industryAverageOrBetter = primaryOrBetter + (scores[2]?.score ?? 0);
  const total = scores.reduce((s, q) => s + (q.score ?? 0), 0);
  const estimated = Math.max(0, total - industryAverageOrBetter);
  return { primaryOrBetter, industryAverageOrBetter, estimated, total };
}
```
Replace `SampleReport.tsx:149`:
```tsx
const quality = summarizeQuality(QUALITY_SCORES);
// …
<p className="text-xs text-surface-400 mt-3">
  {quality.primaryOrBetter}% of total emissions backed by primary source data or better. {quality.estimated}% flagged for improvement.
</p>
```
(Imports `summarizeQuality` from `@/lib/reports/quality-summary`.) Renders
"42%" and "17%". No hand-written summary percentages.

**Risk:** Low. Display-only. Verify the stacked tier ordering (L1,L2,L3,L4-L5)
is not reordered elsewhere.

**Failable check:** `npx vitest run tests/quality-summary.test.ts` asserts
primaryOrBetter=42, industryAverageOrBetter=83, estimated=17, total=100;
`grep -n "83%" src/pages/SampleReport.tsx` returns no hand-written 83 (only
derived if industryAverageOrBetter is shown with a correct label).

---

## P0-04 — Methodology version strings + operational-control wording

**Verified:** `mockData.ts:204` `emissionFactorLib: 'EPA GHG Factor Hub
2024'`; `:22,25` 'EPA eGRID 2024'; `:29,30` 'eGRID WECC 2024'; `:31` 'eGRID
NWPP 2024'; `:24,26,38` 'EPA GHG Factor Hub' (no year); `:119` 'Location-based
(eGRID 2024)'; `:124,125,128,129` 'eGRID WECC 2024' / 'EPA GHG Factor Hub
2024' (LEDGER_ENTRIES). `MethodologyPublic.tsx:238` 'EPA GHG Factor Hub 2024',
`:239` 'eGRID 2024'; `:267` FAQ "operational control, consistent with the
Protocol's recommended approach"; `:270` cadence "EPA GHG Factor Hub in
April, eGRID in January, GLEC in Q3".

**Verified versions (EPA, 2026-07-11):** official latest = eGRID2023 (data
year 2023, published 2025-01-15) and 2025 GHG Emission Factors Hub (data year
2024, published 2025-01). **eGRID2024 is NOT an EPA release** → must be
`verified:false`. Per hard constraint #4, no unverified year asserted as fact.

**Files:**
- `src/lib/emission-factors/registry.ts` (new).
- `src/lib/emission-factors/versions.ts` (new) — re-exports registry.
- `tests/emission-factor-registry.test.ts` (new).
- `src/data/mockData.ts:22,25,29,30,31,119,124,125,128,129,204`.
- `src/pages/MethodologyPublic.tsx:238-243,267,270`.

**Change:** `src/lib/emission-factors/registry.ts`:
```ts
export type EmissionFactorVersion = {
  id: string;
  label: string;          // display label
  publisher: 'US EPA' | 'Smart Freight Centre' | 'Exiobase Consortium' | 'IPCC';
  publishedYear: number;  // year released
  dataYear: number;      // year the data describes
  scopes: ('Scope 1' | 'Scope 2' | 'Scope 3')[];
  verified: boolean;
  note?: string;
};

export const EMISSION_FACTOR_REGISTRY: EmissionFactorVersion[] = [
  {
    id: 'epa-efh-2025',
    label: 'EPA GHG Emission Factors Hub 2025',
    publisher: 'US EPA', publishedYear: 2025, dataYear: 2024,
    scopes: ['Scope 1', 'Scope 2'], verified: true,
  },
  {
    id: 'epa-egrid-2023',
    label: 'eGRID2023',
    publisher: 'US EPA', publishedYear: 2025, dataYear: 2023,
    scopes: ['Scope 2'], verified: true,
  },
  {
    id: 'epa-egrid-2024',
    label: 'eGRID2024',
    publisher: 'US EPA', publishedYear: 2026, dataYear: 2024,
    scopes: ['Scope 2'], verified: false,
    note: 'EPA has not released eGRID2024 (planned Jan 2026, unreleased as of 2026-05-20). Third-party Cornerstone interim dataset exists. Verify before publication.',
  },
  { id: 'glec-v3', label: 'GLEC Framework v3', publisher: 'Smart Freight Centre', publishedYear: 2023, dataYear: 2023, scopes: ['Scope 3'], verified: true },
  { id: 'exiobase-3.8', label: 'EXIOBASE 3.8', publisher: 'Exiobase Consortium', publishedYear: 2023, dataYear: 2022, scopes: ['Scope 3'], verified: true },
  { id: 'ipcc-ar6-gwp100', label: 'IPCC AR6 GWP-100', publisher: 'IPCC', publishedYear: 2021, dataYear: 2021, scopes: ['Scope 1'], verified: true },
];

export function factorLabel(id: string): string {
  const v = EMISSION_FACTOR_REGISTRY.find(e => e.id === id);
  if (!v) return '(verify before publication)';
  return v.verified ? v.label : `${v.label} (verify before publication)`;
}
```
- `mockData.ts`: replace `'EPA GHG Factor Hub 2024'` → `factorLabel('epa-efh-2025')`;
  `'EPA eGRID 2024'`/`'eGRID WECC 2024'`/`'eGRID NWPP 2024'` → use verified
  `factorLabel('epa-egrid-2023')` with subregion prefix preserved (e.g.
  `WECC ${factorLabel('epa-egrid-2023')}`); `'Location-based (eGRID 2024)'`
  → `Location-based (${factorLabel('epa-egrid-2023')})`; `'EPA GHG Factor Hub'`
  (no year) → `factorLabel('epa-efh-2025')`. Do NOT reference eGRID2024 as
  fact; if a subregion string must show "2024" it must be the verified:false
  entry with the `(verify)` suffix.
- `MethodologyPublic.tsx:238` → `factorLabel('epa-efh-2025')`; `:239` →
  `factorLabel('epa-egrid-2023')` (verified). `:267` FAQ replace with:
  "Our organizational boundary default is operational control — Eco-Auditor's
  default. The GHG Protocol also permits equity-share and financial-control
  consolidation; contact us if you need an alternative." `:270` cadence:
  keep "annually when source agencies release new data" but drop the
  hard-coded months, OR keep months only for verified entries.

**Risk:** Mock data is display-only (sample report), but registry labels flow
into the sample report ledger — verify the sample report still renders. If
eGRID2024 (verified:false) is shown anywhere, UI must append "(verify before
publication)". Do not break the `LEDGER_ENTRIES` typing (`as const`).

**Failable check:** `npx vitest run tests/emission-factor-registry.test.ts`
asserts every entry has `publishedYear`, `dataYear`, `verified` boolean; no
entry with `verified:false` is rendered without "(verify)". `grep -rn
"eGRID 2024" src/` returns 0 bare matches (only `factorLabel('epa-egrid-2024')`
with verify suffix). `grep -rn "GHG Factor Hub 2024" src/` returns 0.

---

## P0-05 — "No credit card required" vs Terms auto-charge (Model A vs B)

**Verified billing = Model B (card-backed, auto-charge):** `server.cjs:594-617`
`/api/checkout` subscription sessions, `trial_period_days: 14` only when
`trial && TRIAL_ELIGIBLE_PLANS.has(priceId)` (`:616`);
`TRIAL_ELIGIBLE_PLANS` (`:589-592`) = STARTER_MONTHLY + GROWTH_MONTHLY;
`ALLOWED_PRICE_IDS` (`:579-586`) = all 6 Stripe price env vars.
`ensureCompanyForUser` (`server.cjs:335-338`) auto-provisions
`trial_ends_at = now() + INTERVAL '14 days'`. `TermsOfService.tsx:116` "At
the end of a trial, you will be charged for the selected plan unless you
cancel before the trial expires". Contradicting copy: `LandingPage.tsx:95`
"No credit card required · 14-day free trial · Set up in under 10 minutes";
`:327` "no credit card"; `Signup.tsx:125` "No credit card required. 14-day
free trial. Set up in under 10 minutes."; `SampleReport.tsx:200` "no credit
card required"; `MethodologyPublic.tsx:291` "Start free, no credit card
required"; `Pricing.tsx:29` meta "no credit card required".

**Recommendation: Model B (fix copy only).** Rationale: existing Stripe
wiring is card-backed subscription with 14-day trial that auto-charges
(Terms :116). Model A (no-card, read-only at trial end) would require changing
`/api/checkout` to defer card collection (Stripe `payment_method_collection:
if_required` + mode changes), editing `TRIAL_ELIGIBLE_PLANS`, rewriting the
post-trial downgrade path, and amending Terms :116 — more code, billing risk,
and a Terms change that needs counsel. Model B is a copy-only ponytail: align
marketing with the real contract. Recommend Model B.

**Files:**
- `src/pages/LandingPage.tsx:95,327` (and `:14-15,25` "under 10 minutes",
  `:117,170,325` "audit-ready").
- `src/pages/Signup.tsx:125`.
- `src/pages/SampleReport.tsx:200` (and `:9,37,46` "audit-ready" —
  CORRECTION: brief says `SampleReport.tsx:82` for "audit-ready"; line 82 is
  "GHG Protocol aligned", NOT "audit-ready". The audit-ready strings are at
  `:9` (SCHEMA description), `:37` (meta description), `:46` (restore meta).)
- `src/pages/MethodologyPublic.tsx:291` (and `:67,85,106` "audit-ready").
- `src/pages/Pricing.tsx:29` (meta "no credit card required").

**Change (Model B):**
- Replace "No credit card required" / "no credit card" with: "14-day free
  trial · Card required to start · Cancel anytime before trial ends" (or
  "14-day free trial, then $X/mo" where a price is known). Apply at
  `LandingPage.tsx:95,327`, `Signup.tsx:125`, `SampleReport.tsx:200`,
  `MethodologyPublic.tsx:291`, `Pricing.tsx:29`.
- "Set up in under 10 minutes" (`LandingPage.tsx:95,15,25`, `Signup.tsx:125`):
  soften to "Most teams are up and running quickly" unless verifiable.
- "audit-ready" → qualified "reviewable records" / "defensible" per hard
  constraint #3. Apply at `LandingPage.tsx:117,170,325`;
  `MethodologyPublic.tsx:67,85,106`; `SampleReport.tsx:9,37,46`
  (CORRECTION: not `:82`).
- Keep `Pricing.tsx:222` "$3,990/year" consistent with mockData PLANS
  (growth annual = 3990) — that line is already correct; the JSON-LD/meta
  mismatch is the additional-finding #1, not P0-05.

**Risk:** Marketing/SEO copy change — re-run prerender so static HTML
matches. No billing code change (Model B), so no checkout/billing risk.
Verify `npm run build` still passes (the P0-02 guardrail does not ban these
strings).

**Failable check:** `grep -rn "No credit card" src/` returns 0;
`grep -rn "audit-ready" src/pages/LandingPage.tsx src/pages/MethodologyPublic.tsx
src/pages/SampleReport.tsx` returns 0 (or only qualified "reviewable records");
`npm run build` passes; `curl -s $URL/ | grep -ci "no credit card"` = 0.

---

## P0-06 — trustFacts + compliance overclaims + "NoNDA" typo

**Verified:** `Security.tsx:147` "NoNDA required" (typo); `:99` "GDPR
compliant"; `:100` "CCPA compliant"; `:91` "GDPR-compliant data processing
agreement available"; `:153` "GDPR-compliant DPA for EU customers"; `:9`
SCHEMA "compliance certifications"; `:98` "SOC 2 Type II audit in progress
(Q3 2026)"; `:58` "TLS 1.3 for all API and web traffic" (inconsistent with
`PrivacyPolicy.tsx:163` and `DataProcessingAddendum.tsx:99,217` "TLS 1.2+");
`:68` "Cloud infrastructure on AWS and InsForge (SOC 2-compliant hosts)";
`:108` "Automated daily backups with 30-day retention" (audit says 35-day
`backupsDeletionWindowDays`). DPA Annex III (`:246-251`): generic "Cloud
hosting provider", "Analytics provider", "Email/communications provider",
"Customer support platform" — only Stripe named (`:248`). DPA `:54`
"GDPR-aligned" (correct qualified wording). Per hard constraint #2: do NOT
fabricate subprocessor processingRegion/dpaUrl or hosting provider identity
(Railway vs AWS unverified) → mark `verified:false`, render "(verify before
publication)".

**Files:**
- `src/content/trust-facts.ts` (new).
- `tests/trust-facts.test.ts` (new).
- `src/pages/Security.tsx:9,58,68,91,98-100,108,147,153`.
- `src/pages/DataProcessingAddendum.tsx:246-251` (subprocessor table —
  optional; keep generic unless verified).

**Change:** `src/content/trust-facts.ts`:
```ts
export type TrustFact<T> = { value: T; verified: boolean; note?: string };
export const trustFacts = {
  encryptionInTransitMinimum: { value: 'TLS 1.2', verified: true } as TrustFact<string>,
  preferredTransport:         { value: 'TLS 1.3', verified: true } as TrustFact<string>,
  encryptionAtRest:           { value: 'AES-256', verified: true } as TrustFact<string>,
  accountDeletionRequestWindowDays: { value: 30, verified: true } as TrustFact<number>,
  postTerminationRetentionDays:     { value: 90, verified: true } as TrustFact<number>, // Terms :120
  backupsDeletionWindowDays:        { value: 35, verified: true } as TrustFact<number>, // audit baseline
  contentUsedForModelTraining:      { value: false, verified: true } as TrustFact<boolean>,
  soc2Status:                        { value: 'in progress (Q3 2026)', verified: true } as TrustFact<string>,
  hostingProvider:                   { value: 'VERIFY', verified: false, note: 'Deploy target (Railway?) unverified; AWS claim unverified' } as TrustFact<string>,
  subprocessors: [
    { name: 'Stripe, Inc.', purpose: 'Payment processing', processingRegion: 'United States', dpaUrl: null, verified: true },
    { name: 'Cloud hosting provider', purpose: 'Application hosting', processingRegion: 'VERIFY', dpaUrl: null, verified: false },
    { name: 'Analytics provider', purpose: 'Service monitoring', processingRegion: 'VERIFY', dpaUrl: null, verified: false },
    { name: 'Email/communications provider', purpose: 'Transactional email', processingRegion: 'VERIFY', dpaUrl: null, verified: false },
    { name: 'Customer support platform', purpose: 'Support ticketing', processingRegion: 'VERIFY', dpaUrl: null, verified: false },
  ],
};
export function renderFact<T>(f: TrustFact<T>): string {
  return f.verified ? String(f.value) : '(verify before publication)';
}
```
- `Security.tsx`: `:147` "NoNDA required" → "No NDA required";
  `:99` "GDPR compliant" → "Aligned with GDPR requirements";
  `:100` "CCPA compliant" → "Designed around CCPA requirements";
  `:91`/`:153` "GDPR-compliant DPA" → "GDPR-aligned DPA";
  `:9` SCHEMA "compliance certifications" → "security and compliance
  practices";
  `:98` keep "SOC 2 Type II audit in progress (Q3 2026)" (roadmap wording,
  not achieved — compliant with constraint #3);
  `:58` "TLS 1.3 for all API and web traffic" →
  "Data in transit: TLS 1.2 minimum, TLS 1.3 preferred (see trust-facts)";
  `:68` "AWS and InsForge (SOC 2-compliant hosts)" →
  "Cloud infrastructure on InsForge and a verified hosting provider
  (verify before publication)" — i.e. render `renderFact(trustFacts.hostingProvider)`;
  `:108` "30-day retention" → `${trustFacts.backupsDeletionWindowDays.value}-day
  retention` (35) or render VERIFY.
- DPA `:246-251`: leave generic names unless a subprocessor is verified.
  Stripe stays named (verified:true). Do NOT add processingRegion/dpaUrl
  values that are unverified — render "(verify before publication)".

**Risk:** Security page SEO/schema wording change — re-prerender. TLS
reconciliation must match Privacy/DPA ("TLS 1.2+"). Hosting-provider claim
removal is the safest option (constraint #2).

**Failable check:** `grep -rn "NoNDA" src/` = 0; `grep -rn "GDPR compliant\|CCPA compliant" src/` = 0; `npx vitest run tests/trust-facts.test.ts` asserts every `trustFacts` field has `verified` boolean and no `verified:false` field exposes a non-VERIFY fabricated value; `npm run build` passes.

---

## Additional finding 1 — Pricing structured-data mismatch (P0 trust/SEO)

**Verified:** `Pricing.tsx:12-14` JSON-LD = Starter $49 / Growth $149 / Pro
$499; `Pricing.tsx:29` meta "Free tier, Starter $49/mo, Growth $149/mo, Pro
$499/mo" (+ "no credit card required"); UI renders `mockData.ts PLANS`
(`:212-267`) = $149/$399/$999 monthly; `Pricing.tsx:222` "Growth $3,990/year"
(matches mockData growth annual 3990). `LandingPage.tsx:14` FAQ "$49–$499/month";
`server.cjs:805` (CORRECTION: brief says `:806`; the response string is on
line 805, `:806` is the closing brace) salesbot "$49/$149/custom".
`server.cjs:579-586` ALLOWED_PRICE_IDS = 6 Stripe env vars (real price IDs).
So crawlers see $49/$149/$499 + a non-existent "Free tier"; humans see
$149/$399/$999.

**Files:**
- `src/content/pricing.ts` (new — single source of truth).
- `src/pages/Pricing.tsx:6-16` (PRICING_SCHEMA), `:29` (meta), `:79-104` (UI
  reads PLANS), `:222`.
- `src/data/mockData.ts:212-267` (PLANS) — keep as UI source or replace with
  `src/content/pricing.ts`.
- `server.cjs:805` (salesbot KB), `:579-586` (verify price IDs).
- `src/pages/LandingPage.tsx:14` (FAQ $49–$499).

**Change:** Create `src/content/pricing.ts` exporting `PLANS` with
`monthly`, `annual`, `priceIdEnv` (env var name, not the secret) so JSON-LD,
meta, UI, and salesbot all read one source. Remove "Free tier" from meta
(`:29`) and schema description (`:10`). `Pricing.tsx` PRICING_SCHEMA built
from `pricing.ts`. Salesbot KB (`server.cjs:805`) reads from a shared
constant or is updated to match. Verify the real Stripe price IDs in
`ALLOWED_PRICE_IDS` env match the plans the UI exposes (cross-check
`STRIPE_PRICE_STARTER_MONTHLY` etc. against the displayed prices before
launch — a failable check).

**Risk:** Stripe price-id mismatch would break checkout — verify env values
match `pricing.ts`. SEO: re-prerender so JSON-LD in static HTML matches.

**Failable check:** `npx vitest run tests/pricing.spec.ts` asserts JSON-LD
prices == UI prices == meta prices == salesbot prices, and no "Free tier";
`grep -rn "Free tier" src/` = 0; `grep -rn "49\".*149\".*499" src/pages/Pricing.tsx`
returns 0 (no stale JSON-LD); manual: confirm `STRIPE_PRICE_*` env values
resolve to the plans shown.

---

## Additional finding 2 — /api/health missing SHA + no-store (godmythos Gate 13)

**Verified:** `server.cjs:143-152` `/api/version` HAS SHA (`build:
RAILWAY_GIT_COMMIT_SHA | VERCEL_GIT_COMMIT_SHA`) + `Cache-Control: no-store,
max-age=0, must-revalidate` + `Pragma: no-cache` + `Expires: 0`. `:154-170`
`/health` returns `{status, uptime, version, db, timestamp}` — NO `build`
SHA, NO `Cache-Control: no-store`.

**Files:** `server.cjs:154-170`.

**Change:** Mirror `/api/version` SHA + cache headers in `/health`:
```js
app.get('/health', function (_req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  let dbStatus = 'not configured';
  const insforgeUrl = process.env.INSFORGE_URL || process.env.NEXT_PUBLIC_INSFORGE_URL;
  if (insforgeUrl) dbStatus = 'configured';
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    version: process.env.APP_VERSION || process.env.npm_package_version || '0.0.0',
    build: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
    db: dbStatus,
    timestamp: new Date().toISOString(),
  });
});
```

**Risk:** Low. Adding a `build` field and cache headers is additive. Confirm
godmythos v10.6.1 Gate 13 expects `build` (SHA) on `/api/health` — matches
`/api/version` shape.

**Failable check:** `tests/server.test.ts` (or new `tests/server-health.test.ts`)
asserts `/health` response has `build` field and `Cache-Control: no-store`;
`curl -sI $URL/api/health | grep -i "no-store"` matches.

---

## Additional finding 3 — Dead CTAs on Pricing

**Verified:** `Pricing.tsx:135` "Book demo" button (no onClick/href); `:213`
"Talk to sales" (no onClick); `:214` "Book a demo" (no onClick). No `/demo`
route exists (`App.tsx:269-279` has no `/demo`). P1-02.

**Files:** `src/pages/Pricing.tsx:135,213-214`; optionally `src/App.tsx` +
`src/pages/Demo.tsx` if a /demo route is built.

**Change (ponytail):** Wire the three buttons to `/contact`:
```tsx
// :135
<Link to="/contact" className="w-full py-2 rounded-lg text-sm font-medium …">Book demo</Link>
// :213-214
<Link to="/contact" className="btn-primary">Talk to sales</Link>
<Link to="/contact" className="btn-secondary">Book a demo</Link>
```
(Import `Link` from `react-router-dom` — already imported at `Pricing.tsx:2`.)
Alternatively build a `/demo` page — larger scope, defer.

**Risk:** Low. Ensure the `/contact` route exists (it is in PRERENDERED_ROUTES
and sitemap, so it exists).

**Failable check:** `grep -n "onClick\|to=\"/contact\"\|href" src/pages/Pricing.tsx`
shows the three CTAs wired; `npx vitest run tests/pricing.spec.ts` asserts no
button is a bare `<button>` with no handler.

---

## Additional finding 4 — Per-page meta not in static HTML (P1-07)

**Verified:** `MethodologyPublic.tsx:63-88`, `Security.tsx:13-29`,
`Pricing.tsx:25-41`, `SampleReport.tsx:33-49` set `document.title`/meta/JSON-LD
via useEffect → absent from prerendered HTML (crawlers see the default title
from `static/index.html`). `prerender.mjs` only injects the #root body, not
per-route head meta.

**Files:** `scripts/prerender.mjs:92-115` (render loop); optionally
`src/content/head-manifest.ts` (new).

**Change:** Add a per-route head manifest consumed by `prerender.mjs`:
```js
const HEAD = {
  '/methodology': { title: 'Carbon Accounting Methodology — Eco-Auditor | GHG Protocol Alignment',
    description: 'Eco-Auditor follows the GHG Protocol Corporate Standard…' },
  '/security': { title: 'Security & Trust — Eco-Auditor | Data Protection and Compliance',
    description: '…' },
  '/pricing': { title: 'Pricing — Eco-Auditor | Carbon Accounting Plans for SMBs', description: '…' },
  '/sample-report': { title: 'Sample Carbon Report — Eco-Auditor | See What You Get', description: '…' },
};
```
In the render loop, after building `out`, inject:
```js
const h = HEAD[route];
if (h) {
  out = out
    .replace(/<title>[^<]*<\/title>/, `<title>${h.title}</title>`)
    .replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${h.description}"`);
}
```
(JSON-LD injection can be added similarly per route.) This duplicates the
useEffect values into static HTML. Keep the useEffect for client-side
navigation.

**Risk:** Title/description regex replacement must not corrupt the template
(escape `"` in descriptions). Verify each prerendered file's `<title>`.

**Failable check:** After `node scripts/prerender.mjs`:
`grep -o "<title>[^<]*</title>" static/methodology/index.html` returns the
methodology title (not the homepage default); same for security/pricing/
sample-report.

---

## Sequenced implementation order (dependencies first)

1. **P0-02 guardrail** (`scripts/check-legal-placeholders.mjs` + build wire +
   test). Establish the launch gate first so later copy edits are bounded.
   Note: build will FAIL until counsel replaces placeholders — run the
   guardrail as a standalone script during dev, not via `npm run build`, until
   legal sign-off. Document in launch-readiness checklist.
2. **Shared content modules** with no dependencies:
   - `src/content/trust-facts.ts` (P0-06) + test.
   - `src/lib/emission-factors/registry.ts` + `versions.ts` (P0-04) + test.
   - `src/lib/reports/quality-summary.ts` (P0-03) + test.
   - `src/content/pricing.ts` (Additional #1).
3. **P0-03** SampleReport math (depends on quality-summary).
4. **P0-04** methodology strings + operational-control wording (depends on
   registry).
5. **P0-06** Security overclaims + NoNDA + TLS reconciliation (depends on
   trust-facts).
6. **P0-05** Model B copy edits (no code dep; can run parallel with 3-5).
7. **Additional #1** Pricing single-source-of-truth (depends on
   `src/content/pricing.ts`); verify Stripe price IDs.
8. **P0-01** prerender /login,/signup + SPA fallback + robots.txt `/signup` +
   plan-aware signup (depends on nothing; do after copy edits so the
   prerendered auth HTML reflects final copy).
9. **Additional #4** per-route meta injection in `prerender.mjs` (after 3-6 so
   final titles/descriptions are stable).
10. **Additional #2** `/api/health` SHA + no-store (independent; can land
    anytime).
11. **Additional #3** dead CTAs → `/contact` (independent; anytime).
12. **Final verification:** `npx vitest run` (all new tests green),
    `npm run lint`, `node scripts/prerender.mjs`, `grep` checks for each P0,
    manual `curl` of /login,/signup,/pricing, godmythos Gate 13 health check.
    Branch first (currently on master per constraint #8); atomic commits per
    P0 with `Co-Authored-By: Claude <noreply@anthropic.com>`.

---

## Brief corrections (wrong or unverified claims)

1. **`SampleReport.tsx:82` "audit-ready" — WRONG.** Line 82 reads `GHG
   Protocol aligned` (badge), not "audit-ready". The "audit-ready" strings in
   `SampleReport.tsx` are at `:9` (SCHEMA description), `:37` (meta
   description), `:46` (restore meta). P0-05 must target `:9,37,46`, not
   `:82`.
2. **`server.cjs:806` salesbot — off by one.** The pricing response text is
   on line **805**; line 806 is the closing `}` of the first KB object.
   Additional-finding #1 should reference `:805`.
3. **`PrivacyPolicy.tsx:160` "TLS 1.2+" — off by a few lines.** The
   `data-security` section opens at `:160`, but the "TLS 1.2+" bullet is at
   `:163`. Minor; P0-06 reconciliation targets the string, not a line.
4. **robots.txt — brief says "ensure robots.txt disallows them [login and
   signup]".** `public/robots.txt` **already** contains `Disallow: /login`
   and `Disallow: /auth/`; it does NOT disallow `/signup`. Only `/signup` needs
   adding. sitemap.xml already excludes both.
5. **eGRID release year — brief says "eGRID 2023… released 2024".** WRONG per
   EPA.gov: eGRID2023 was released **2025-01-15** (rev2 2025-06-12), not
   2024. The brief's overall conclusion (eGRID2024 is not an EPA release) is
   CORRECT and verified (EPA still lists eGRID2024 as "next planned" as of
   2026-05-20). Registry encodes eGRID2023 as verified:true (publishedYear
   2025, dataYear 2023) and eGRID2024 as verified:false.
6. **prerender.mjs comment vs entry-server.tsx — doc inconsistency (not a
   brief claim).** `prerender.mjs:13-17` comment says "renderToStaticMarkup
   and not renderToString"; `entry-server.tsx:14` actually uses
   `renderToString`. Stale comment; does not affect fixes but should be
   corrected to avoid confusion.
7. **Unverified (cannot confirm from repo):** whether the real deploy target
   is Railway or AWS (`Security.tsx:68` claims AWS; DPA `:247` says generic
   "Cloud hosting provider"). Per constraint #2, mark `hostingProvider`
   `verified:false` — do not assert either.
8. **Unverified:** real Stripe price IDs behind
   `STRIPE_PRICE_{STARTER,GROWTH,PRO}_{MONTHLY,ANNUAL}` env vars — must be
   cross-checked against `src/content/pricing.ts` before launch (Additional
   #1 failable check).
9. **Unverified:** "Set up in under 10 minutes" claim
   (`LandingPage.tsx:15,25,95`, `Signup.tsx:125`) — soften per P0-05 unless
   product confirms a measured baseline.
10. **`scripts/build-partials.js` — present (344 lines, Header CTA-slot design
    authority / code-gen for `src/components/Header.tsx`).** The brief lists
    it as a file to verify but makes no file:line claims. If any Header CTA
    copy changes (none required by these P0s), edit `build-partials.js` and
    regenerate `Header.tsx`; otherwise untouched. Not a brief error.