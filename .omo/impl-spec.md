# Eco-Auditor P0 Implementation Spec (architect-verified)

> Produced by the architect agent (fable-5, READ-ONLY) verifying
> `.omo/fusion3-merged-plan.md` against the live repo on 2026-07-11.
> This is the single source of truth for the executor (debugger) agent.

## Verification summary

19 source files inspected. Most line numbers accurate. Found **4 hard plan
errors**, **2 missed edit sites that break failable checks**, **3 under-counted
edit sites**, **1 misplaced guard note**. 4 new shared modules sound; consumer
wiring feasible. Sequenced order dependency-correct. Executor-ready **with
corrections below applied**.

## Corrections to the merged plan (executor MUST apply)

### C1. Security.tsx :17 is NOT an "audit-ready" site
- `:17` = `'Eco-Auditor uses enterprise-grade encryption (AES-256, TLS 1.3), SOC 2-aligned controls…'` — no "audit-ready", no "compliance certifications", already §3-compliant "SOC 2-aligned". **No edit at :17.** Only :26 has "audit-ready" among meta lines; only :9 has "compliance certifications".

### C2. Security.tsx :91 string is NOT "GDPR-compliant DPA"
- `:91` = `'GDPR-compliant data processing agreement available',` (full phrase).
- `:153` = `'GDPR-compliant DPA for EU customers'` (this one IS "DPA").
- Use two distinct old_strings:
  - :91 → `GDPR-aligned data processing agreement available`
  - :153 → `GDPR-aligned DPA for EU customers`

### C3. Signup.tsx :130 needs NO window guard
- `:130` = `{!isInsForgeConfigured && (` — JSX conditional, no `window`. `src/lib/insforge.ts:24` `isInsForgeConfigured = Boolean(baseUrl && anonKey)` from `import.meta.env` (SSR-safe). **No window guard anywhere.** Drop the :130 guard note.

### C4. Security.tsx edit set = `:9, :26, :58, :68, :91, :99, :100, :147, :153` only
- `:17` no edit (C1). `:98` keep "SOC 2 Type II audit in progress (Q3 2026)" (roadmap §3.3). `:108` keep "30-day retention" (verified facts: 30, not 35).

### C5. mockData.ts — ADD bare 'EPA GHG Factor Hub' at :24, :26, :38 (plan omitted)
- `:24` `factor: 'EPA GHG Factor Hub',` (Fleet diesel)
- `:26` `factor: 'EPA GHG Factor Hub',` (Propane — forklifts)
- `:38` `factor: 'EPA GHG Factor Hub',` (Employee commuting)
- All three → `factor: factorLabel('epa-efh-2025'),` (import `factorLabel` from `@/lib/emission-factors/registry`).

### C6. mockData.ts :23 'IPCC AR6 GWP' (no -100 suffix) — optional, recommended for consistency
- `:23` `factor: 'IPCC AR6 GWP',` → `factorLabel('ipcc-ar6-gwp100')`. `:131` already `'IPCC AR6 GWP-100',` → also `factorLabel('ipcc-ar6-gwp100')`. Not launch-gating but recommended.

### C7. LandingPage.tsx — ADD :156 and :212 audit-ready sites (plan missed; failable check fails without)
- 6 audit-ready sites, not 4: `:85, :117, :156, :170, :212, :325` → "reviewable records" / "defensible".
  - :85 `…increasingly want audit-ready emissions data…`
  - :117 `Get audit-ready reports`
  - :156 `See how Eco-Auditor turns messy data into audit-ready carbon records`
  - :170 `<span className="font-medium">Audit-ready ledger</span>`
  - :212 `Four steps to audit-ready emissions`
  - :325 `Ready to get audit-ready?`

### C8. LandingPage.tsx — "$49–$499/month" at :14 AND :24
- :14 (FAQ_SCHEMA) and :24 (FAQS array) both contain `$49–$499/month versus six-figure annual licenses`. Edit both → "Starter through Pro plans available".

### C9. DataProcessingAddendum.tsx :281 is NOT a bracketed placeholder
- :281 = "Specific SCC annex details…shall be completed upon execution. This DPA does not constitute a signed SCC agreement until countersigned…" — no bracketed token; guardrail won't flag it. **No action on :281.** Bracketed placeholder sites: `TermsOfService.tsx:49,166,186,187`; `PrivacyPolicy.tsx:58`; `DataProcessingAddendum.tsx:50`.

## Plan-level issues

### I1. TLS reconciliation — edit only Security.tsx :58
- `Security.tsx:58` → "Data in transit: TLS 1.2 minimum, TLS 1.3 preferred". Leave `PrivacyPolicy.tsx:163` and `DataProcessingAddendum.tsx:99,217` as "TLS 1.2+" (already consistent).

### I2. App.tsx router wiring already correct — no change
- `App.tsx:275-278` `/signup`, `/login`, `/auth/callback`, `*` NotFound all present.

### I3. server.cjs comment :1519-1521 must be updated
- After adding `/login`,`/signup` to PRERENDERED_ROUTES (:1523-1526), edit comment :1519-1521 to drop `/login, /signup` (keep `(/app/*, /auth/*)` only).

### I4. server.cjs PRERENDERED_ROUTES currently 8 routes — add /login and /signup
- `:1523-1526` = `['/pricing','/methodology','/sample-report','/security','/contact','/privacy','/terms','/dpa']`. Add both. Leave `/` out (served by static/index.html directly).

### I5. AF-4 regex risk — verify single title/description in template
- `out.replace(/<title>[^<]*<\/title>/,…)` and `out.replace(/<meta name="description" content="[^"]*"/,…)` hit only the FIRST match. Verify `static/index.html` has exactly one `<title>` and one description meta before running AF-4. Escape `"` in description strings.

### I6. Tailwind 3.4 LOCKED — confirmed (`package.json:36`). No v4.

### I7. Dev deps available — `vitest ^4.1.4`, `jsdom ^29.0.2`, `tsx ^4.21.0`, `@types/node ^24.12.2`. No new install needed.

## Sequenced execution (dependency-verified)

1. **P0-02 guardrail** (no deps): `scripts/check-legal-placeholders.mjs` + `package.json:11` build wire + `build:skip-legal` + `tests/legal-placeholders.test.ts`.
2. **Shared modules** (no deps): `src/content/trust-facts.ts`, `src/lib/emission-factors/registry.ts` (+ `versions.ts`), `src/lib/reports/quality-summary.ts`, `src/content/pricing.ts` — each with vitest test.
3. **P0-03** SampleReport math (consumes quality-summary).
4. **P0-04** methodology strings + operational-control wording (consumes registry).
5. **P0-06** Security overclaims + NoNDA + TLS + DPA (consumes trust-facts).
6. **P0-05** Model B copy edits (no code dep).
7. **AF-1** Pricing single source of truth (consumes pricing.ts); reconcile against `ALLOWED_PRICE_IDS` env.
8. **P0-01** prerender /login,/signup + SPA fallback + robots.txt /signup + plan-aware signup (after copy edits).
9. **AF-4** per-route meta in prerender.mjs (after 3-6; includes /login,/signup titles).
10. **AF-2** /api/health SHA + no-store (independent).
11. **AF-3** dead CTAs → /contact (independent).
12. **Final verification:** `npx vitest run`, `npm run lint`, `node scripts/prerender.mjs`, per-P0 greps, `curl` smoke of /login,/signup,/pricing,/health.

> **During execution use `npm run build:skip-legal` (NOT `npm run build`) — the full build is intentionally a launch gate that FAILS while legal placeholders remain.**

## Per-P0 executor instructions

### P0-01 — /login,/signup prerender + noindex + plan-aware signup
- `scripts/prerender.mjs`: extend ROUTES (:37-47) add `'/login'`,`'/signup'`. Add `NOINDEX_ROUTES = new Set(['/login','/signup'])`. Inject `noindex,nofollow` meta into `out` between :99 and :101. Fix stale comment :13-17 (says renderToStaticMarkup; entry-server.tsx:14 uses renderToString).
- `server.cjs`: add `'/login'`,`'/signup'` to PRERENDERED_ROUTES (:1523-1526). Update comment :1519-1521 (drop `/login, /signup`).
- `public/robots.txt`: add `Disallow: /signup` only (already has `/login` :9, `/auth/` :10 — do NOT duplicate).
- `Login.tsx`/`Signup.tsx`: useEffect setting `<meta name="robots" content="noindex,nofollow">` client-side, remove on unmount.
- **Drop Signup.tsx:130 window guard (C3).**
- Plan-aware signup (`Signup.tsx`): import `useSearchParams` from `react-router-dom` (currently imports `Link, useNavigate` at :1); read `?plan=starter|growth|pro&billing=monthly|annual&source=pricing`; after `insforge.auth.signUp` succeeds + `data?.accessToken` present, if plan param exists navigate to `/app?checkout=${plan}_${billing}`. Uses existing `insforge.auth.signUp` (§3.6).
- Failable: `node scripts/prerender.mjs` exits 0 with `✓ /login`,`✓ /signup`; `grep -l noindex static/login/index.html static/signup/index.html` both match; `grep -ci "start your free trial" static/login/index.html` = 0; new `tests/routes-prerender.spec.ts`.

### P0-02 — Legal-placeholder CI launch-gate guardrail
- New `scripts/check-legal-placeholders.mjs`: scan `src/pages/{TermsOfService,PrivacyPolicy,DataProcessingAddendum}.tsx` for `[Date to be set`, `[AMOUNT TO BE SET`, `[Jurisdiction to be set`, `[Dispute resolution mechanism`, `[PLACEHOLDER]`, `TBD`, `to be set upon legal review`. **Exclude** `"business draft for review"`. Non-zero → `process.exit(1)`.
- `package.json:11`: `"build": "node scripts/check-legal-placeholders.mjs && tsc -b && vite build && node scripts/prerender.mjs"`, add `"build:skip-legal": "tsc -b && vite build && node scripts/prerender.mjs"`.
- New `tests/legal-placeholders.test.ts` (vitest wrapper).
- Confirmed bracketed placeholder sites (guardrail flags): `TermsOfService.tsx:49,166,186,187`; `PrivacyPolicy.tsx:58`; `DataProcessingAddendum.tsx:50`. **NOT :281** (C9). Operator "Developer312 / NIGHT LITE USA LLC" (`TermsOfService.tsx:57`) is named, not a placeholder.
- Build FAILS today (intended). Engineers use `npm run build:skip-legal`.

### P0-03 — SampleReport 83% math bug
- New `src/lib/reports/quality-summary.ts` with `summarizeQuality()` (null-safe `scores[i]?.score ?? 0`):
  ```ts
  export type QualityScore = { label: string; score: number; color?: string };
  export type QualitySummary = {
    primaryOrBetter: number; industryAverageOrBetter: number; estimated: number; total: number;
  };
  export function summarizeQuality(scores: QualityScore[]): QualitySummary {
    const primaryOrBetter = (scores[0]?.score ?? 0) + (scores[1]?.score ?? 0);
    const industryAverageOrBetter = primaryOrBetter + (scores[2]?.score ?? 0);
    const total = scores.reduce((s, q) => s + (q.score ?? 0), 0);
    const estimated = Math.max(0, total - industryAverageOrBetter);
    return { primaryOrBetter, industryAverageOrBetter, estimated, total };
  }
  ```
- `SampleReport.tsx:149` replace literal `83% of total emissions backed by primary source data or better. 17% flagged for improvement.` with `summarizeQuality(QUALITY_SCORES)`-driven `{quality.primaryOrBetter}% … {quality.estimated}% …` (renders 42% / 17%). `QUALITY_SCORES` :20-25 unchanged.
- Do NOT touch `SampleReport.tsx:82` ("GHG Protocol aligned" badge — verified).
- Failable: `npx vitest run src/lib/reports/quality-summary.test.ts` asserts primaryOrBetter=42, industryAverageOrBetter=83, estimated=17, total=100; `grep -n "83%" src/pages/SampleReport.tsx` returns no hand-written 83.

### P0-04 — Methodology version strings + operational-control wording
- New `src/lib/emission-factors/registry.ts`:
  ```ts
  export type EmissionFactorVersion = {
    id: string; label: string;
    publisher: 'US EPA' | 'Smart Freight Centre' | 'Exiobase Consortium' | 'IPCC';
    publishedYear: number; dataYear: number;
    scopes: ('Scope 1' | 'Scope 2' | 'Scope 3')[];
    verified: boolean; note?: string;
  };
  export const EMISSION_FACTOR_REGISTRY: EmissionFactorVersion[] = [
    { id: 'epa-efh-2025', label: 'EPA GHG Emission Factors Hub 2025',
      publisher: 'US EPA', publishedYear: 2025, dataYear: 2024,
      scopes: ['Scope 1', 'Scope 2'], verified: true },
    { id: 'epa-egrid-2023', label: 'eGRID2023',
      publisher: 'US EPA', publishedYear: 2025, dataYear: 2023,
      scopes: ['Scope 2'], verified: true },
    { id: 'glec-v3', label: 'GLEC Framework v3', publisher: 'Smart Freight Centre',
      publishedYear: 2023, dataYear: 2023, scopes: ['Scope 3'], verified: true },
    { id: 'exiobase-3.8', label: 'EXIOBASE 3.8', publisher: 'Exiobase Consortium',
      publishedYear: 2023, dataYear: 2022, scopes: ['Scope 3'], verified: true },
    { id: 'ipcc-ar6-gwp100', label: 'IPCC AR6 GWP-100', publisher: 'IPCC',
      publishedYear: 2021, dataYear: 2021, scopes: ['Scope 1'], verified: true },
  ];
  export function factorLabel(id: string): string {
    const v = EMISSION_FACTOR_REGISTRY.find(e => e.id === id);
    if (!v) return '(verify before publication)';
    return v.verified ? v.label : `${v.label} (verify before publication)`;
  }
  ```
  Plus `src/lib/emission-factors/versions.ts` re-exporting.
- `mockData.ts` edits (corrected): `:22,:25` (`EPA eGRID 2024` → `factorLabel('epa-egrid-2023')`); `:24,:26,:38` (bare `EPA GHG Factor Hub` → `factorLabel('epa-efh-2025')`) **[C5]**; `:29,:30` (`eGRID WECC 2024` → `` `WECC ${factorLabel('epa-egrid-2023')}` ``); `:31` (`eGRID NWPP 2024` → `` `NWPP ${factorLabel('epa-egrid-2023')}` ``); `:119` (`Location-based (eGRID 2024)` → `` `Location-based (${factorLabel('epa-egrid-2023')})` ``); `:124,:125` (`eGRID WECC 2024` → prefixed); `:128,:129,:204` (`EPA GHG Factor Hub 2024` → `factorLabel('epa-efh-2025')`). Optional: `:23,:131` → `factorLabel('ipcc-ar6-gwp100')` **[C6]**. Import `factorLabel` from `@/lib/emission-factors/registry`.
- `MethodologyPublic.tsx`: `:238` → `factorLabel('epa-efh-2025')`; `:239` → `factorLabel('epa-egrid-2023')`; `:267` FAQ → "Our organizational boundary default is operational control — Eco-Auditor's default. The GHG Protocol also permits equity-share and financial-control consolidation; contact us if you need an alternative."; `:270` cadence: keep "annually when source agencies release new data", drop hard-coded months for unverified entries.
- §3.4: NO `eGRID 2024` string remains as fact.
- Failable: `npx vitest run tests/emission-factor-registry.test.ts`; `grep -rn "eGRID 2024" src/` = 0; `grep -rn "GHG Factor Hub 2024" src/` = 0.

### P0-05 — "No credit card required" contradicts Terms auto-charge (Model B)
- **LandingPage.tsx** (corrected [C7,C8]):
  - No-credit-card: `:95,:327` → "14-day free trial · Card required to start · Cancel anytime before trial ends".
  - "Set up in under 10 minutes": `:15,:25,:95` → "Most teams are up and running quickly".
  - "$49–$499/month": `:14 AND :24` **[C8]** → "Starter through Pro plans available".
  - audit-ready (6 sites [C7]): `:85,:117,:156,:170,:212,:325` → "reviewable records" / "defensible".
- `Signup.tsx:125` `No credit card required. 14-day free trial. Set up in under 10 minutes.` → card-required + "Most teams are up and running quickly".
- `SampleReport.tsx:200` `…no credit card required.` → card-required wording. audit-ready at `:9,:37,:46` (NOT :82 — badge).
- `MethodologyPublic.tsx:291` `Start free, no credit card required.` → card-required. audit-ready at `:67,:85,:106`.
- `Pricing.tsx`: `:29` meta (drop "Free tier" + "no credit card required" + "audit-ready"); `:10` JSON-LD (drop "free tier"); `:38,:220` audit-ready → reviewable. Remove "Free tier" from `:10,:29`. Keep `:222` "$3,990/year" (correct, AF-1).
- `Security.tsx`: audit-ready ONLY at `:26` **[C1]** → reviewable.
- Failable: `grep -rn "No credit card" src/` = 0; `grep -rn "audit-ready" src/pages/{LandingPage,MethodologyPublic,SampleReport,Pricing,Security}.tsx` = 0; `grep -rn "Free tier" src/pages/Pricing.tsx` = 0; `npm run build:skip-legal` passes.

### P0-06 — trustFacts + compliance overclaims + NoNDA + TLS reconciliation
- New `src/content/trust-facts.ts`:
  ```ts
  export type TrustFact<T> = { value: T; verified: boolean; note?: string };
  export const trustFacts = {
    encryptionInTransitMinimum: { value: 'TLS 1.2', verified: true } as TrustFact<string>,
    preferredTransport:         { value: 'TLS 1.3', verified: true } as TrustFact<string>,
    encryptionAtRest:           { value: 'AES-256', verified: true } as TrustFact<string>,
    accountDeletionRequestWindowDays: { value: 30, verified: true } as TrustFact<number>,
    postTerminationRetentionDays:     { value: 90, verified: true } as TrustFact<number>,
    backupsDeletionWindowDays:        { value: 30, verified: false } as TrustFact<number>,
    contentUsedForModelTraining:      { value: false, verified: true } as TrustFact<boolean>,
    soc2Status: { value: 'in progress (Q3 2026)', verified: true } as TrustFact<string>,
    cloudHosting: { value: 'VERIFY', verified: false,
      note: 'Deploy target (Railway vs AWS) unverified; code says AWS, DPA says generic. Verify before publication.' } as TrustFact<string>,
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
- `Security.tsx` edits (corrected set [C1,C2,C4]):
  - `:9` SCHEMA "compliance certifications" → "security and compliance practices".
  - `:17` **NO EDIT** (C1).
  - `:26` meta "audit-ready" → "reviewable".
  - `:58` "TLS 1.3 for all API and web traffic" → "Data in transit: TLS 1.2 minimum, TLS 1.3 preferred".
  - `:68` "Cloud infrastructure on AWS and InsForge (SOC 2-compliant hosts)" → `renderFact(trustFacts.cloudHosting)`.
  - `:91` "GDPR-compliant data processing agreement available" → "GDPR-aligned data processing agreement available" **[C2]**.
  - `:99` "GDPR compliant — DPA available on request" → "Aligned with GDPR requirements".
  - `:100` "California Consumer Privacy Act (CCPA) compliant" → "Designed around CCPA requirements".
  - `:147` "NoNDA required" → "No NDA required".
  - `:153` "GDPR-compliant DPA for EU customers" → "GDPR-aligned DPA for EU customers" **[C2]**.
  - `:98` keep "SOC 2 Type II audit in progress (Q3 2026)" (roadmap §3.3). `:108` keep "30-day retention" (30, not 35).
- `DataProcessingAddendum.tsx:246-251`: keep generic subprocessor names (already compliant; only Stripe named). No fabricated processingRegion/dpaUrl. `:54` already "GDPR-aligned". `:99,:217` stay "TLS 1.2+" (I1). `:50` placeholder stays (P0-02 gate). `:281` no action (C9).
- §3.2: no fabricated Railway, no fabricated 35.
- Failable: `grep -rn "NoNDA" src/` = 0; `grep -rn "GDPR compliant\|CCPA compliant" src/` = 0; `npx vitest run tests/trust-facts.test.ts` asserts every `trustFacts` field has `verified` boolean and no verified:false field exposes a fabricated non-VERIFY value; `npm run build:skip-legal` passes.

### AF-1 — Pricing single source of truth
- New `src/content/pricing.ts` exporting `PLANS` with `monthly`, `annual`, `priceIdEnv` (env var NAME, not the secret).
- `Pricing.tsx:6-16` PRICING_SCHEMA built from `pricing.ts`; remove "Free tier" from `:10,:29`; `:79-104` UI reads `PLANS`; `:222` kept.
- `mockData.ts:212-267` PLANS — `pricing.ts` is canonical; mockData PLANS should import from it or be removed (single source).
- `server.cjs:805` salesbot KB `…• **Starter** — $49/mo…• **Growth** — $149/mo…• **Enterprise** — Custom pricing…` — update to match `pricing.ts` (three-way mismatch: JSON-LD $49/$149/$499 vs UI $149/$399/$999 vs salesbot $49/$149/custom). Reconcile against live `STRIPE_PRICE_*` env (launch-readiness checklist).
- `LandingPage.tsx:14,:24` handled under P0-05 (C8).
- Failable: `npx vitest run tests/pricing.spec.ts` asserts JSON-LD prices == UI prices == meta prices == salesbot prices, no "Free tier"; `grep -rn "Free tier" src/` = 0; `grep -rn '49".*149".*499' src/pages/Pricing.tsx` = 0.

### AF-2 — /api/health SHA + no-store
- `server.cjs:154-170` `/health`: add `Cache-Control: no-store, max-age=0, must-revalidate`, `Pragma: no-cache`, `Expires: 0`, and `build: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null` field (mirrors `/api/version` :143-152). Keep `status`, `uptime`, `version`, `db`, `timestamp`.
- Failable: `tests/server-health.test.ts` asserts `build` field + `Cache-Control: no-store`; `curl -sI $URL/api/health | grep -i "no-store"`; `curl -s $URL/api/health | jq .build` non-null when SHA env set.

### AF-3 — Dead CTAs on Pricing → /contact
- `Pricing.tsx`: `Link` already imported at `:2`. Wire `:135` "Book demo", `:213` "Talk to sales", `:214` "Book a demo" to `<Link to="/contact">`. Current strings: `:213` `<button className="btn-primary">Talk to sales</button>`, `:214` `<button className="btn-secondary">Book a demo</button>`.
- Failable: `grep -n "to=\"/contact\"" src/pages/Pricing.tsx` shows three CTAs; `tests/pricing.spec.ts` asserts no bare `<button>` without handler.

### AF-4 — Per-route meta in prerender
- `scripts/prerender.mjs`: add `HEAD` manifest with titles/descriptions for `/methodology`,`/security`,`/pricing`,`/sample-report`,`/login` (title only, noindex),`/signup` (title only, noindex). Inject after `out` built and after noindex injection (P0-01). Regex replace `<title>` and `<meta name="description">`.
- **I5 risk**: verify `static/index.html` has exactly one `<title>` and one description meta before running. Escape `"` in descriptions.
- Failable: `grep -o "<title>[^<]*</title>" static/methodology/index.html` returns methodology title (not homepage); same for security/pricing/sample-report/login/signup.

## §3 Hard Constraints (restated)

- **P0-02**: no invented legal values; bracketed placeholders stay until counsel; "business draft for review" banners stay.
- **P0-06**: `backupsDeletionWindowDays=30 verified:false` NOT 35; `cloudHosting='VERIFY'` NOT 'Railway'; compliance wording "supports"/"maps to"/"designed around"/"aligned with" — never "GDPR compliant"/"CCPA compliant"/"audit-ready"/"compliant"; SOC 2 "in progress" only.
- **P0-04**: eGRID2023 + EPA GHG Factor Hub 2025 both verified:true; NO "eGRID 2024" as fact.
- **Tailwind 3.4 LOCKED** (`package.json:36`).
- **Ponytail**: shortest working diff; ONE runnable check per module; never simplify away validation/error-handling/security/a11y.
- **Git**: branch first (on master); atomic commits per P0; `Co-Authored-By: Claude <noreply@anthropic.com>` trailer; no push, no commit unless explicitly instructed.