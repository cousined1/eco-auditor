# fusion-3 Merged Fix Plan — Eco-Auditor P0s

## Panel provenance

Degraded panel `opus4.8-gpt5.6`. Gemini 3.1 Pro panelist was dropped after retry
(agy `--print` did not emit a long-form response and ignored `--model`, falling
back to Gemini 3.5 Flash both times — see `.omo/fusion3-provenance.md`).
**Coverage gap:** no Gemini-family cross-check. The Opus + GPT-5.6 triangulation
still provides cross-family verification across two frontier families, but a
third-family sanity check is absent. Treat any decision that turned on a close
2-way call as lower-confidence and re-verify before publication.

Ground truth applied: `.omo/fusion3-verified-facts.md` (orchestrator-verified
via EPA.gov on 2026-07-11). Where a panelist contradicts those facts, the facts
win. This plan is ANALYSIS/PLAN ONLY — no repo files are edited.

## Judge merge rationale

- **P0-01 (prerender /login,/signup):** Both tracks agree on the shape (extend
  ROUTES, add to PRERENDERED_ROUTES, inject noindex meta, useEffect client-side,
  robots.txt, plan-aware signup). Adopted Plan A (opus) as the backbone because
  it carries the verified brief-correction that `robots.txt` already disallows
  `/login` and `/auth/` (only `/signup` needs adding) and correctly drops the
  `:1520-1522` server.cjs comment about auth fallthrough. Grafted Plan B's
  (gpt5) risk note that `Signup.tsx:130` `isInsForgeConfigured` may touch
  `window` and needs a `typeof window !== 'undefined'` guard if so.
- **P0-02 (legal guardrail):** Both tracks produce the same script. Adopted
  Plan A's BANNED list, which **excludes** `"business draft for review"` — the
  brief's own clarification says the draft banners are intentional pre-launch
  labeling and may stay; only the bracketed placeholders are the launch gate.
  Plan B's inclusion of the banner in BANNED would force removing the banner,
  contradicting the brief. Grafted Plan B's `build:skip-legal` dev-escape hatch
  as a documented option. Added the vitest wrapper test (Plan A) so the ponytail
  "ONE runnable check" rule is satisfied.
- **P0-03 (83% math):** Functionally identical tracks. Adopted Plan A's
  null-safe `scores[i]?.score ?? 0` implementation and its test asserting
  primaryOrBetter=42, industryAverageOrBetter=83, estimated=17, total=100.
  Rejected Plan B's conflation of `SampleReport.tsx:82` as an "audit-ready"
  line — verified facts confirm :82 is the "GHG Protocol aligned" badge, and
  the audit-ready strings are at :9, :37, :46 (handled under P0-05).
- **P0-04 (eGRID / GHG Factor Hub versions):** Fully adopted Plan A. The
  verified facts REJECT Plan B's "eGRID 2022" and "keep 2024 verified:true"
  proposals (the latter violates §3.4). Merged registry uses eGRID2023
  (dataYear 2023, publishedYear 2025, verified:true) and EPA GHG Factor Hub
  2025 (dataYear 2024, publishedYear 2025, verified:true). Dropped Plan A's
  speculative eGRID2024 verified:false registry entry to respect ponytail
  (nothing references it after the fix); the verification status is documented
  in the launch checklist instead.
- **P0-05 (Model B):** Both tracks independently recommend Model B; verified
  facts confirm. Adopted Plan A's precise line corrections (SampleReport :82
  is the badge, audit-ready at :9/:37/:46) and grafted Plan B's broader
  audit-ready sweep across `Security.tsx:9,17,26` and `Pricing.tsx:38,220`
  (the brief's P0-05 scope explicitly includes Security.tsx). Kept Plan A's
  note that `Pricing.tsx:222` "$3,990/year" is correct and belongs to AF-1.
- **P0-06 (trustFacts):** Both tracks are OVERRIDDEN by the verified facts on
  `backupsDeletionWindowDays`: the value 35 appears in NO source file
  (`Security.tsx:108` says "30-day retention"); per §3.2 the merged plan sets
  `trustFacts.backupsDeletionWindowDays = { value: 30, verified: false }` and
  leaves `Security.tsx:108` unchanged (no 30→35 edit). Rejected Plan B's
  `cloudHosting: 'Railway + InsForge'` (fabricates Railway — violates §3.2);
  adopted Plan A's `cloudHosting: 'VERIFY', verified: false`. Adopted Plan A's
  split `encryptionInTransitMinimum`/`preferredTransport` fields (matches the
  brief's spec shape) and `renderFact()` helper. Adopted Plan B's `soc2Status`
  roadmap wording as a graft.
- **AF-1 (pricing single source of truth):** Both tracks agree on
  `src/content/pricing.ts`. Adopted Plan A's corrected `server.cjs:805`
  salesbot line (brief's :806 is the closing brace) and the three-way mismatch
  framing ($49/$149/$499 JSON-LD vs $149/$399/$999 UI vs $49/$149/custom
  salesbot).
- **AF-2 (/api/health SHA + no-store):** Adopted Plan A's fuller mirror of
  `/api/version` (Cache-Control + Pragma + Expires + `build` field + db
  status). Plan B's version omits Pragma/Expires and db status.
- **AF-3 (dead CTAs):** Adopted Plan A's `<Link to="/contact">` (keeps users
  in-app, `Link` already imported at `Pricing.tsx:2`). Noted Plan B's
  `mailto:` as an alternative.
- **AF-4 (per-route meta in prerender):** Both tracks use a HEAD manifest in
  `prerender.mjs`. Adopted Plan A's manifest shape and grafted Plan B's
  inclusion of `/login` and `/signup` title entries (added under P0-01's
  noindex routes — title only, no description, since they are noindex).

## Sequenced implementation order (dependencies first)

1. **P0-02 guardrail** — `scripts/check-legal-placeholders.mjs` + build wire +
   vitest wrapper. Establish the launch gate first. Build will FAIL until
   counsel replaces bracketed placeholders; during dev, run the script
   standalone or via `npm run build:skip-legal` (documented escape hatch).
   Branch first (currently on master per §3.8).
2. **Shared content modules** (no deps): `src/content/trust-facts.ts` (P0-06),
   `src/lib/emission-factors/registry.ts` (P0-04), `src/lib/reports/quality-summary.ts`
   (P0-03), `src/content/pricing.ts` (AF-1) — each with its vitest test.
3. **P0-03** SampleReport math (depends on quality-summary).
4. **P0-04** methodology strings + operational-control wording (depends on registry).
5. **P0-06** Security overclaims + NoNDA + TLS reconciliation (depends on trust-facts).
6. **P0-05** Model B copy edits (no code dep; can run parallel with 3-5).
7. **AF-1** Pricing single source of truth (depends on `src/content/pricing.ts`);
   verify Stripe price IDs against `ALLOWED_PRICE_IDS` env.
8. **P0-01** prerender /login,/signup + SPA fallback + robots.txt `/signup` +
   plan-aware signup (after copy edits so prerendered auth HTML reflects final copy).
9. **AF-4** per-route meta injection in `prerender.mjs` (after 3-6 so titles/
   descriptions are stable; includes /login,/signup titles).
10. **AF-2** `/api/health` SHA + no-store (independent; anytime).
11. **AF-3** dead CTAs → `/contact` (independent; anytime).
12. **Final verification:** `npx vitest run` (all new tests green), `npm run lint`,
    `node scripts/prerender.mjs`, per-P0 grep checks, manual `curl` of
    /login,/signup,/pricing,/health, godmythos v10.6.1 Gate 13 health check.
    Atomic commits per P0 with `Co-Authored-By: Claude <noreply@anthropic.com>`.
    Do NOT push or commit unless explicitly instructed.

---

## P0-01 — /login and /signup resolve to homepage content for non-JS clients

**Files:**
- `scripts/prerender.mjs:37-47` (ROUTES), `:92-115` (render loop), `:13-17` (stale comment — fix in passing: says renderToStaticMarkup but `entry-server.tsx:14` uses renderToString).
- `server.cjs:1523-1526` (PRERENDERED_ROUTES), `:1520-1522` (comment to update).
- `public/robots.txt` (add `Disallow: /signup` only — `/login` and `/auth/` already present).
- `src/pages/Login.tsx` (useEffect noindex guard), `src/pages/Signup.tsx` (same + plan-aware), `Signup.tsx:130` (`isInsForgeConfigured` window guard if needed).
- `src/App.tsx:275-276` (router wiring — verified correct, no change).

**Change:**
1. `scripts/prerender.mjs` — extend ROUTES and add a NOINDEX set:
   ```js
   const ROUTES = ['/', '/pricing', '/methodology', '/sample-report',
     '/security', '/contact', '/privacy', '/terms', '/dpa',
     '/login', '/signup'];
   const NOINDEX_ROUTES = new Set(['/login', '/signup']);
   ```
   In the render loop, after building `out` and before the `if (route === '/')` write:
   ```js
   if (NOINDEX_ROUTES.has(route)) {
     out = out.replace('</head>',
       '<meta name="robots" content="noindex,nofollow"></head>');
   }
   ```
2. `server.cjs:1523-1526` — add `/login`,`/signup` to PRERENDERED_ROUTES (before SPA fallback at `:1542-1545`). Remove the `/login, /signup, /auth/*` fallthrough comment at `:1520-1522` (now prerendered).
3. `public/robots.txt` — add `Disallow: /signup` under the existing `Disallow: /login`. Do NOT duplicate `/login` or `/auth/`.
4. `Login.tsx` / `Signup.tsx` — add a `useEffect` that sets `<meta name="robots" content="noindex,nofollow">` client-side and removes it on unmount (defensive; prerendered HTML already has it for crawlers). Guard `Signup.tsx:130` `isInsForgeConfigured` with `typeof window !== 'undefined'` if it references `window`.
5. Plan-aware signup (`Signup.tsx`): import `useSearchParams`; read `?plan=starter|growth|pro&billing=monthly|annual&source=pricing`; after `insforge.auth.signUp` succeeds and `data?.accessToken` is present, if a plan param exists navigate to `/app?checkout=${plan}_${billing}` (or redirect to `/api/checkout`). Uses existing `insforge.auth.signUp` — no new SDK surface (§3.6).

**Risk:** SSR render of /login,/signup could fail if any top-level import touches `window`/InsForge. Verified safe: auth components call InsForge only in handlers (`entry-server.tsx:14` renderToString; Login h1 "Sign in to Eco-Auditor" at `Login.tsx:72`, Signup h1 "Start your free trial" at `Signup.tsx:123`). Noindex must not leak into hydrated client (useEffect cleanup). Sitemap already excludes both.

**Failable check:**
- `node scripts/prerender.mjs` exits 0 and logs `✓ /login` and `✓ /signup`.
- `grep -l "noindex" static/login/index.html static/signup/index.html` → both match.
- `grep -ci "sign in to eco-auditor" static/login/index.html` ≥ 1; `grep -ci "start your free trial" static/signup/index.html` ≥ 1.
- `grep -ci "Start your free trial" static/login/index.html` = 0 (no homepage hero leak); `grep -ci "Carbon accounting" static/signup/index.html` = 0.
- `curl -s $URL/login | grep -i "sign in"` returns the auth h1, not homepage.
- New `tests/routes-prerender.spec.ts` asserts `static/login/index.html` contains `noindex` + auth h1 and does NOT contain homepage hero.

---

## P0-02 — Legal placeholders: CI launch-gate guardrail

**Files:**
- `scripts/check-legal-placeholders.mjs` (new).
- `package.json:11` (`build` script). Add `build:skip-legal` dev escape hatch.
- `tests/legal-placeholders.test.ts` (new — vitest wrapper).

**Change:** Create `scripts/check-legal-placeholders.mjs` scanning
`src/pages/{TermsOfService,PrivacyPolicy,DataProcessingAddendum}.tsx` for:
`[Date to be set`, `[AMOUNT TO BE SET`, `[Jurisdiction to be set`,
`[Dispute resolution mechanism`, `[PLACEHOLDER]`, `TBD`,
`to be set upon legal review`. **Excludes** `"business draft for review"` —
the draft banners are intentional pre-launch labeling (brief P0-02 clarification)
and stay until legal sign-off. Non-zero match → `process.exit(1)`.

Wire into `build` **before** `tsc -b`:
```json
"build": "node scripts/check-legal-placeholders.mjs && tsc -b && vite build && node scripts/prerender.mjs",
"build:skip-legal": "tsc -b && vite build && node scripts/prerender.mjs"
```
Per §3.1: do NOT invent legal values. Placeholders stay until counsel sign-off;
the guardrail is a launch gate — `npm run build` FAILS while any bracketed
placeholder remains. `tests/legal-placeholders.test.ts` imports the script logic
and asserts it fails on a sample banned phrase and passes when none present.

Confirmed placeholder sites (not edited): `TermsOfService.tsx:49,166,186,187`;
`PrivacyPolicy.tsx:58`; `DataProcessingAddendum.tsx:50,281`. Operator entity
"Developer312, a subsidiary of NIGHT LITE USA LLC" (`TermsOfService.tsx:57`) is
already named — NOT a placeholder. Qualified compliance language already present
at `TermsOfService.tsx:149,182`; `DataProcessingAddendum.tsx:54` ("GDPR-aligned").

**Risk:** Build fails today (placeholders present) — intended. Must be documented
in the launch-readiness checklist so counsel's replacement unblocks the build.
Engineers use `npm run build:skip-legal` during dev.

**Failable check:** `node scripts/check-legal-placeholders.mjs; echo $?` →
non-zero today; `npx vitest run tests/legal-placeholders.test.ts` fails today;
after counsel replaces all bracketed tokens, both pass.

---

## P0-03 — Sample report 83% math bug

**Files:**
- `src/lib/reports/quality-summary.ts` (new).
- `src/lib/reports/quality-summary.test.ts` (new) or `tests/quality-summary.test.ts`.
- `src/pages/SampleReport.tsx:20-25` (QUALITY_SCORES — unchanged), `:149` (replace 83%).

**Change:** Create `src/lib/reports/quality-summary.ts`:
```ts
export type QualityScore = { label: string; score: number; color?: string };
export type QualitySummary = {
  primaryOrBetter: number;         // L1 + L2
  industryAverageOrBetter: number; // L1 + L2 + L3
  estimated: number;               // L4 + L5 (remaining)
  total: number;
};
export function summarizeQuality(scores: QualityScore[]): QualitySummary {
  const primaryOrBetter = (scores[0]?.score ?? 0) + (scores[1]?.score ?? 0);
  const industryAverageOrBetter = primaryOrBetter + (scores[2]?.score ?? 0);
  const total = scores.reduce((s, q) => s + (q.score ?? 0), 0);
  const estimated = Math.max(0, total - industryAverageOrBetter);
  return { primaryOrBetter, industryAverageOrBetter, estimated, total };
}
```
Replace `SampleReport.tsx:149` "83% of total emissions backed by primary source
data or better. 17% flagged for improvement." with:
```tsx
const quality = summarizeQuality(QUALITY_SCORES);
// …
{quality.primaryOrBetter}% of total emissions backed by primary source data or better. {quality.estimated}% flagged for improvement.
```
Renders "42%" and "17%". No hand-written summary percentages anywhere.
Note: `SampleReport.tsx:82` is the "GHG Protocol aligned" badge (verified) —
NOT touched here; its audit-ready strings at :9, :37, :46 are handled under P0-05.

**Risk:** Low. Display-only. Verify the stacked tier ordering (L1,L2,L3,L4-L5)
is not reordered elsewhere.

**Failable check:** `npx vitest run src/lib/reports/quality-summary.test.ts`
asserts primaryOrBetter=42, industryAverageOrBetter=83, estimated=17, total=100;
`grep -n "83%" src/pages/SampleReport.tsx` returns no hand-written 83.

---

## P0-04 — Methodology version strings + operational-control wording

**Files:**
- `src/lib/emission-factors/registry.ts` (new) + `versions.ts` (re-export).
- `tests/emission-factor-registry.test.ts` (new).
- `src/data/mockData.ts:22,25,29,30,31,119,124,125,128,129,204`.
- `src/pages/MethodologyPublic.tsx:238-243,267,270`.

**Change:** Create `src/lib/emission-factors/registry.ts` (verified facts
applied — eGRID2023 verified:true, EPA GHG Factor Hub 2025 verified:true):
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
- `mockData.ts`: replace `'EPA GHG Factor Hub 2024'` → `factorLabel('epa-efh-2025')`;
  `'EPA eGRID 2024'`/`'eGRID WECC 2024'`/`'eGRID NWPP 2024'` →
  `factorLabel('epa-egrid-2023')` with subregion prefix preserved (e.g.
  `` `WECC ${factorLabel('epa-egrid-2023')}` ``); `'Location-based (eGRID 2024)'`
  → `` `Location-based (${factorLabel('epa-egrid-2023')})` ``; bare
  `'EPA GHG Factor Hub'` (no year) → `factorLabel('epa-efh-2025')`.
- `MethodologyPublic.tsx:238` → `factorLabel('epa-efh-2025')`; `:239` →
  `factorLabel('epa-egrid-2023')`. `:267` FAQ → "Our organizational boundary
  default is operational control — Eco-Auditor's default. The GHG Protocol also
  permits equity-share and financial-control consolidation; contact us if you
  need an alternative." `:270` cadence: keep "annually when source agencies
  release new data" but drop hard-coded months for unverified entries.

Per §3.4 and verified facts: no `eGRID 2024` string remains as fact. Plan B's
"eGRID 2022" and "keep 2024 verified:true" proposals are REJECTED.

**Risk:** Mock data is display-only (sample report), but registry labels flow
into the sample report ledger — verify the sample report still renders. Do not
break `LEDGER_ENTRIES` `as const` typing.

**Failable check:** `npx vitest run tests/emission-factor-registry.test.ts`
asserts every entry has `publishedYear`, `dataYear`, `verified` boolean, and
no `verified:false` entry renders without "(verify before publication)";
`grep -rn "eGRID 2024" src/` = 0; `grep -rn "GHG Factor Hub 2024" src/` = 0.

---

## P0-05 — "No credit card required" contradicts Terms auto-charge (Model B)

**Adopted: Model B** (fix marketing copy only; no billing-code/Stripe/Terms
change). Verified facts confirm; both tracks agree. Existing Stripe wiring is
card-backed subscription with 14-day trial that auto-charges
(`server.cjs:594-617`, `trial_period_days:14` only for
`TRIAL_ELIGIBLE_PLANS` at `:589-592` = STARTER_MONTHLY + GROWTH_MONTHLY;
`TermsOfService.tsx:116` auto-charge clause). Model B is the ponytail:
zero billing risk, zero Terms amendment.

**Files:**
- `src/pages/LandingPage.tsx:95,327` (no-credit-card), `:14,15,25` (FAQ "under 10 minutes" + "$49–$499/month"), `:85,117,170,325` (audit-ready).
- `src/pages/Signup.tsx:125` (no-credit-card + under 10 minutes).
- `src/pages/SampleReport.tsx:200` (no-credit-card); `:9,37,46` (audit-ready — verified, NOT :82).
- `src/pages/MethodologyPublic.tsx:291` (no-credit-card); `:67,85,106` (audit-ready).
- `src/pages/Pricing.tsx:29` (meta "no credit card required" + "Free tier"); `:10` (JSON-LD "free tier"); `:38,220` (audit-ready).
- `src/pages/Security.tsx:9,17,26` (schema/meta "compliance certifications"/"audit-ready").

**Change (Model B):**
- Replace "No credit card required" / "no credit card" → "14-day free trial ·
  Card required to start · Cancel anytime before trial ends" (or compact
  "Card required · 14-day free trial"). Apply at `LandingPage.tsx:95,327`,
  `Signup.tsx:125`, `SampleReport.tsx:200`, `MethodologyPublic.tsx:291`,
  `Pricing.tsx:29`.
- "Set up in under 10 minutes" (`LandingPage.tsx:95,15,25`, `Signup.tsx:125`)
  → "Most teams are up and running quickly" (unverified — softened per §3).
- "audit-ready" → qualified "reviewable records" / "defensible" (per §3.3).
  Apply at `LandingPage.tsx:85,117,170,325`; `MethodologyPublic.tsx:67,85,106`;
  `SampleReport.tsx:9,37,46` (NOT :82 — that is the "GHG Protocol aligned" badge);
  `Pricing.tsx:38,220`; `Security.tsx:9,17,26` (grafted from Plan B's broader sweep).
- Remove "Free tier" from `Pricing.tsx:10,29` (no free tier exists in PLANS).
- `LandingPage.tsx:14,24` "$49–$499/month" → "Starter through Pro plans
  available" (avoids hardcoding wrong prices; AF-1 reconciles real prices).
- Keep `Pricing.tsx:222` "$3,990/year" (matches mockData growth annual 3990 —
  correct; belongs to AF-1, not P0-05).

**Risk:** Marketing/SEO copy change — re-run prerender so static HTML matches.
No billing code change (Model B), so no checkout/billing risk. Verify
`npm run build` still passes (P0-02 guardrail does not ban these strings).

**Failable check:** `grep -rn "No credit card" src/` = 0;
`grep -rn "audit-ready" src/pages/LandingPage.tsx src/pages/MethodologyPublic.tsx src/pages/SampleReport.tsx src/pages/Pricing.tsx src/pages/Security.tsx` = 0 (or only qualified "reviewable records");
`grep -rn "Free tier" src/pages/Pricing.tsx` = 0; `npm run build` passes;
`curl -s $URL/ | grep -ci "no credit card"` = 0.

---

## P0-06 — trustFacts + compliance overclaims + "NoNDA" typo

**Files:**
- `src/content/trust-facts.ts` (new) + `tests/trust-facts.test.ts` (new).
- `src/pages/Security.tsx:9,58,68,91,98,99,100,108,147,153,17,26`.
- `src/pages/DataProcessingAddendum.tsx:246-251` (subprocessor table — keep generic unless verified).

**Change:** Create `src/content/trust-facts.ts` (verified facts applied —
`backupsDeletionWindowDays` = 30 verified:false; `cloudHosting` = VERIFY not Railway):
```ts
export type TrustFact<T> = { value: T; verified: boolean; note?: string };
export const trustFacts = {
  encryptionInTransitMinimum: { value: 'TLS 1.2', verified: true } as TrustFact<string>,
  preferredTransport:         { value: 'TLS 1.3', verified: true } as TrustFact<string>,
  encryptionAtRest:           { value: 'AES-256', verified: true } as TrustFact<string>,
  accountDeletionRequestWindowDays: { value: 30, verified: true } as TrustFact<number>,
  postTerminationRetentionDays:     { value: 90, verified: true } as TrustFact<number>, // Terms :120
  backupsDeletionWindowDays:        { value: 30, verified: false } as TrustFact<number>, // Security.tsx:108 documents 30; NOT infra-confirmed
  contentUsedForModelTraining:      { value: false, verified: true } as TrustFact<boolean>,
  soc2Status: { value: 'in progress (Q3 2026)', verified: true } as TrustFact<string>, // roadmap wording, §3.3
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
- `Security.tsx:147` "NoNDA required" → "No NDA required".
- `:99` "GDPR compliant" → "Aligned with GDPR requirements";
  `:100` "CCPA compliant" → "Designed around CCPA requirements".
- `:91`/`:153` "GDPR-compliant DPA" → "GDPR-aligned DPA".
- `:9` SCHEMA "compliance certifications" → "security and compliance practices";
  `:17,26` meta "audit-ready" → "reviewable" (grafted from Plan B).
- `:98` keep "SOC 2 Type II audit in progress (Q3 2026)" (roadmap wording, §3.3 — not achieved).
- `:58` "TLS 1.3 for all API and web traffic" → "Data in transit: TLS 1.2 minimum, TLS 1.3 preferred" (reconciles with `PrivacyPolicy.tsx:163` and `DataProcessingAddendum.tsx:99,217` "TLS 1.2+").
- `:68` "AWS and InsForge (SOC 2-compliant hosts)" → render `renderFact(trustFacts.cloudHosting)` (displays "(verify before publication)").
- `:108` "30-day retention" **stays as-is** (verified facts: matches documented value; trustFacts entry reconciles to 30 + verified:false behind the scenes). No visible change to that line.
- DPA `:246-251`: keep generic subprocessor names unless verified. Stripe stays named (verified:true). Do NOT add processingRegion/dpaUrl values that are unverified — render "(verify before publication)" (§3.2).

Per §3.2: do NOT fabricate subprocessor processingRegion/dpaUrl or hosting
provider identity. Plan B's `cloudHosting: 'Railway + InsForge'` is REJECTED
(fabricates Railway). The value 35 for `backupsDeletionWindowDays` is NOT
asserted anywhere (neither code nor trustFacts); it is recorded only as a
recommendation in the launch-readiness checklist.

**Risk:** Security page SEO/schema wording change — re-prerender. TLS
reconciliation must match Privacy/DPA ("TLS 1.2+"). Hosting-provider claim
removal is the safest option (§3.2).

**Failable check:** `grep -rn "NoNDA" src/` = 0;
`grep -rn "GDPR compliant\|CCPA compliant" src/` = 0;
`npx vitest run tests/trust-facts.test.ts` asserts every `trustFacts` field has
`verified` boolean and no `verified:false` field exposes a fabricated non-VERIFY
value (30 is the documented code value, not fabricated); `npm run build` passes.

---

## Additional finding 1 — Pricing structured-data mismatch (P0 trust/SEO)

**Files:**
- `src/content/pricing.ts` (new — single source of truth).
- `src/pages/Pricing.tsx:6-16` (PRICING_SCHEMA), `:10` (JSON-LD "free tier"), `:29` (meta), `:79-104` (UI reads PLANS), `:222`.
- `src/data/mockData.ts:212-267` (PLANS) — keep as UI source or replace with `pricing.ts`.
- `server.cjs:805` (salesbot KB — corrected from brief's :806 which is the closing brace), `:579-586` (ALLOWED_PRICE_IDS).
- `src/pages/LandingPage.tsx:14` (FAQ "$49–$499/month").

**Change:** Create `src/content/pricing.ts` exporting `PLANS` with `monthly`,
`annual`, `priceIdEnv` (env var name, not the secret) so JSON-LD, meta, UI, and
salesbot all read one source. Three-way mismatch confirmed: JSON-LD
$49/$149/$499 (`Pricing.tsx:12-14`) vs UI/mockData $149/$399/$999
(`mockData.ts:212-267`) vs salesbot $49/$149/custom (`server.cjs:805`). Remove
"Free tier" from meta (`:29`) and schema description (`:10`). `Pricing.tsx`
PRICING_SCHEMA built from `pricing.ts`. Salesbot KB (`server.cjs:805`) reads from
the shared constant or is updated to match. The correct values depend on the
real Stripe price IDs behind `STRIPE_PRICE_{STARTER,GROWTH,PRO}_{MONTHLY,ANNUAL}`
env vars — `pricing.ts` must be reconciled against live Stripe config before
launch (launch-readiness checklist).

**Risk:** Stripe price-id mismatch would break checkout — verify env values
match `pricing.ts`. SEO: re-prerender so JSON-LD in static HTML matches.

**Failable check:** `npx vitest run tests/pricing.spec.ts` asserts JSON-LD
prices == UI prices == meta prices == salesbot prices, and no "Free tier";
`grep -rn "Free tier" src/` = 0; `grep -rn '49\".*149\".*499' src/pages/Pricing.tsx` = 0 (no stale JSON-LD);
manual: confirm `STRIPE_PRICE_*` env values resolve to the plans shown.

---

## Additional finding 2 — /api/health missing SHA + no-store (godmythos Gate 13)

**Files:** `server.cjs:154-170` (`/health`); reference `:143-152` (`/api/version`).

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

**Risk:** Low. Adding `build` field + cache headers is additive. Matches
`/api/version` shape; godmythos v10.6.1 Gate 13 expects `build` (SHA) on
`/api/health`.

**Failable check:** `tests/server-health.test.ts` asserts `/health` response
has `build` field and `Cache-Control: no-store`;
`curl -sI $URL/api/health | grep -i "no-store"` matches;
`curl -s $URL/api/health | jq .build` non-null when SHA env set.

---

## Additional finding 3 — Dead CTAs on Pricing

**Files:** `src/pages/Pricing.tsx:135,213-214`. (`Link` already imported at `:2`.)

**Change (ponytail):** Wire the three buttons to `/contact` via `<Link>`:
```tsx
// :135
<Link to="/contact" className="w-full py-2 rounded-lg text-sm font-medium …">Book demo</Link>
// :213-214
<Link to="/contact" className="btn-primary">Talk to sales</Link>
<Link to="/contact" className="btn-secondary">Book a demo</Link>
```
Alternative (Plan B): `mailto:hello@developer312.com?subject=Demo%20Request` —
not preferred (sends users out of app). Building a `/demo` page is larger scope; defer.

**Risk:** Low. `/contact` is in PRERENDERED_ROUTES and sitemap — exists.

**Failable check:** `grep -n "to=\"/contact\"" src/pages/Pricing.tsx` shows the three CTAs wired;
`npx vitest run tests/pricing.spec.ts` asserts no bare `<button>` without handler.

---

## Additional finding 4 — Per-page meta not in static HTML (P1-07)

**Files:** `scripts/prerender.mjs:92-115` (render loop); optionally `src/content/head-manifest.ts`.

**Change:** Add a per-route HEAD manifest consumed by `prerender.mjs`:
```js
const HEAD = {
  '/methodology': { title: 'Carbon Accounting Methodology — Eco-Auditor | GHG Protocol Alignment', description: '…' },
  '/security': { title: 'Security & Trust — Eco-Auditor | Data Protection and Compliance', description: '…' },
  '/pricing': { title: 'Pricing — Eco-Auditor | Carbon Accounting Plans for SMBs', description: '…' },
  '/sample-report': { title: 'Sample Carbon Report — Eco-Auditor | See What You Get', description: '…' },
  '/login': { title: 'Sign in to Eco-Auditor' },      // noindex — title only
  '/signup': { title: 'Start your free trial — Eco-Auditor' }, // noindex — title only
};
```
In the render loop, after building `out` (and after noindex injection from P0-01):
```js
const h = HEAD[route];
if (h) {
  out = out
    .replace(/<title>[^<]*<\/title>/, `<title>${h.title}</title>`)
    .replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${h.description ?? ''}"`);
}
```
Keep the useEffect for client-side navigation. JSON-LD injection can be added
similarly per route if needed.

**Risk:** Title/description regex replacement must not corrupt the template
(escape `"` in descriptions). Verify each prerendered file's `<title>`.

**Failable check:** After `node scripts/prerender.mjs`:
`grep -o "<title>[^<]*</title>" static/methodology/index.html` returns the methodology title (not homepage default); same for security/pricing/sample-report/login/signup.

---

## Shared modules

- `src/content/trust-facts.ts` — consumed by `Security.tsx` (P0-06), DPA subprocessor table. Test: `tests/trust-facts.test.ts`.
- `src/lib/emission-factors/registry.ts` (+ `versions.ts` re-export) — consumed by `mockData.ts` (P0-04), `MethodologyPublic.tsx` (P0-04). Test: `tests/emission-factor-registry.test.ts`.
- `src/lib/reports/quality-summary.ts` — consumed by `SampleReport.tsx` (P0-03). Test: `src/lib/reports/quality-summary.test.ts`.
- `src/content/pricing.ts` — consumed by `Pricing.tsx` (AF-1), `LandingPage.tsx` (P0-05/AF-1), `server.cjs` salesbot (AF-1). Test: `tests/pricing.spec.ts`.
- `scripts/check-legal-placeholders.mjs` — consumed by `package.json` build (P0-02). Test: `tests/legal-placeholders.test.ts`.
- Optional `src/content/head-manifest.ts` — consumed by `scripts/prerender.mjs` (AF-4).

---

## Still-unverified (launch-readiness checklist)

Each must be `verified:false` / rendered "(verify before publication)" until
confirmed by the human. Do NOT publish guessed values.

- [ ] **Deploy target (Railway vs AWS):** code says "AWS and InsForge"
  (`Security.tsx:68`); DPA (`:246`) says generic "Cloud hosting provider".
  `trustFacts.cloudHosting` = VERIFY. Confirm actual infra before publication.
- [ ] **Stripe price IDs / amounts:** $49/$149/$499 (JSON-LD) vs
  $149/$399/$999 (UI/mockData) vs $49/$149/custom (salesbot) — three-way
  mismatch. Reconcile `src/content/pricing.ts` against live
  `STRIPE_PRICE_{STARTER,GROWTH,PRO}_{MONTHLY,ANNUAL}` env config before launch.
- [ ] **"Set up in under 10 minutes":** softened to "Most teams are up and
  running quickly" unless product confirms a measured baseline.
- [ ] **`backupsDeletionWindowDays`:** `trustFacts` = 30 + verified:false
  (code documents 30 at `Security.tsx:108`; NOT infra-confirmed). The audit's
  value 35 is a **recommendation** to raise with ops, recorded here, NOT a
  published value. Confirm actual backup retention with ops; update
  `trustFacts` + `Security.tsx:108` together once confirmed.
- [ ] **Subprocessor processingRegion / dpaUrl:** Stripe is named (verified).
  Railway/InsForge/analytics/email/support identities + regions + DPA URLs
  are VERIFY — do NOT fabricate. Confirm with legal/ops before publication.
- [ ] **Legal placeholders:** `TermsOfService.tsx:49,166,186,187`;
  `PrivacyPolicy.tsx:58`; `DataProcessingAddendum.tsx:50,281`. Counsel must
  replace all bracketed tokens; `npm run build` is the launch gate (fails until
  replaced). Draft banners may stay until legal sign-off.
- [ ] **eGRID2024 release:** not an EPA release as of 2026-07-11 (EPA "Detailed
  Data" page updated 2026-05-20 still lists eGRID2023 as latest). Registry uses
  eGRID2023 verified:true. When EPA releases eGRID2024, add a verified:true
  entry and update `mockData.ts`/`MethodologyPublic.tsx` references.
- [ ] **Coverage gap:** Gemini 3.1 Pro panelist dropped — no Gemini-family
  cross-check. Re-verify close 2-way calls before publication.