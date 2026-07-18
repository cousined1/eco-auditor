# Eco-Auditor UI/UX Launch Audit — Reconciliation & Fix Report

**Audit source:** `ecoauditor-ui-ux-mvp-audit-2026-07-11.md` (July 11, 2026 public-site audit)
**Reconciliation date:** 2026-07-15
**HEAD:** `2168f2b` (master)
**Method:** godmythos v10.7.1 REVIEW + FIX mode, SaaS launch audit skill v2.1 (UI/UX domains A + J)
**Verdict:** **CONDITIONALLY LAUNCHABLE** — 1 remaining Critical (P0-02, gated to Legal HUMAN action)

---

## 1. Executive summary

The July 11 audit rated Eco-Auditor **5.9/10** and identified 6 P0 (Critical)
and 13 P1 (High) UI/UX findings. Reconciling each finding against current code
(`HEAD 2168f2b`) shows **5 of 6 P0 items already fixed** in commits between
July 11 and July 15, and **11 of 13 P1 items already fixed**. The remaining
open work is small and falls in the audit skill's safe-fix allowlist.

This session applied the safe FIX-NOW items (P1-06, P1-13) and documented the
single remaining Critical (P0-02) as a HUMAN action with a proposed diff,
because the audit skill §3 Phase-4 places legal content in the
never-auto-apply domain.

### Score change
- July 11 audit: **5.9 / 10** (Hold broad launch)
- After reconciliation + this session's fixes: **~8.4 / 10** (Conditionally
  Launchable — pending P0-02 legal sign-off)

---

## 2. Findings reconciliation (current code vs. July 11 audit)

| ID | Audit severity | Status | Evidence (current code) |
|---|---|---|---|
| **P0-01** Repair `/login` and `/signup` | Critical | ✅ FIXED | `src/pages/Login.tsx`, `src/pages/Signup.tsx` render real auth forms (email/password + Google/Azure OAuth). `scripts/prerender.mjs:40-58` prerenders both routes with `noindex,nofollow` so crawlers and non-JS clients see route-appropriate content, not the homepage SPA shell. Plan-aware signup preserved (`Signup.tsx:86-92` reads `plan`/`billing` query params). |
| **P0-02** Remove public legal drafts/placeholders | Critical | ❌ **OPEN → HUMAN** | Placeholder *tokens* gone (`check-legal-placeholders.mjs` passes). But the "business draft for review" banner still shows on all 3 legal pages (`TermsOfService.tsx:44-46`, `PrivacyPolicy.tsx:51-55`, `DataProcessingAddendum.tsx:45-47`). Per audit skill §3, legal content is never-auto-apply → documented as `LEGAL-1` in `HUMAN_ACTIONS.md` with proposed diff. |
| **P0-03** Correct sample-report data-quality statement | Critical | ✅ FIXED | `src/lib/reports/quality-summary.ts` `summarizeQuality()` derives `primaryOrBetter = 8+34 = 42` and `estimated = 17` from `QUALITY_SCORES`. `SampleReport.tsx:150-153` renders `${quality.primaryOrBetter}% … backed by primary source data or better. ${quality.estimated}% flagged for improvement.` No hardcoded 83%. Unit-tested. |
| **P0-04** Correct methodology source versions and standards language | Critical | ✅ FIXED | `MethodologyPublic.tsx` consumes `factorLabel()` from `src/lib/emission-factors/registry.ts` (versioned factor registry). Operational-control language qualified: "Eco-Auditor defaults to the operational-control approach… The GHG Protocol also permits equity-share and financial-control approaches" (`MethodologyPublic.tsx:270`). FAQ calls out annual update timing tied to source releases. |
| **P0-05** Reconcile trial, billing, and compliance claims | Critical | ✅ FIXED | `TermsOfService.tsx:116` states the no-card trial model precisely: "No payment method is required… If you do not add a payment method… the workspace becomes read-only — no automatic charge occurs." `claims.ts` `no-card-trial` claim is `approved` with evidence citing `server.cjs TRIAL_ELIGIBLE_PLANS`. Homepage, Pricing, Signup, Terms all describe one model. |
| **P0-06** One source of truth for security/retention/subprocessors | Critical | ✅ FIXED | `src/content/trust-facts.ts` is the structured trust-facts module. `Security.tsx`, `PrivacyPolicy.tsx`, `DataProcessingAddendum.tsx` all consume `renderFact()`. `cloudHosting` uses `VERIFY` sentinel (not fabricated). Unit-tested in `tests/trust-facts.test.ts`. |
| **P1-01** Real downloadable sample report | High | ✅ FIXED | 4 files exist: `public/sample-report/pacific-freight-fy2026.pdf`, `pacific-freight-activity-data.csv`, `pacific-freight-factor-register.csv`, `pacific-freight-evidence-index.csv`. `SampleReport.tsx:190-237` renders accessible download cards with file type + size. All labeled fictional. |
| **P1-02** Dedicated demo flow | High | ✅ FIXED | `src/pages/Demo.tsx` exists with 25–30 min agenda, 6 goal radio options (customer-RFP, Scope 1/2 baseline, supplier Scope 3, SB 253, internal tracking, consultant workflow), facility count + deadline fields, `intent=demo` payload, confirmation state with next steps. |
| **P1-03** Pricing inclusion/exclusion explicit | High | ✅ FIXED | `Pricing.tsx:132-139` renders `<span className="sr-only">Included: </span>` and `<span className="sr-only">Not included: </span>` on every feature line. Billing cadence shown beside every price (`:114-121`). Annual savings computed: `save ${(plan.monthly * 12 - plan.annual).toLocaleString()} vs monthly`. |
| **P1-04** One canonical CTA system | High | ✅ FIXED | `src/components/Header.tsx:93-110` `DEFAULT_CTA` maps one label → one intent across all variants: `Log In → /login`, `Start Free Trial → /signup`, `Book a Demo → /demo`. |
| **P1-05** Persistent navigation on contact/legal pages | High | ✅ FIXED | `Header.tsx:80-88` `legal` variant keeps full nav (Pricing, Methodology, Sample Report, Security) + CTAs (Log In, Start Free Trial). `App.tsx:180-202` renders `<Header variant="legal" />` on `/privacy`, `/terms`, `/dpa`, `/contact`. |
| **P1-06** Contact-page polish and intent handling | High | ✅ FIXED (this session) | Topic preselect from `?topic=` query worked already (`ContactUs.tsx:7-17,21`). Removed the orphan copyright card that duplicated the global Footer (`ContactUs.tsx` right column). Decorative emoji icons now `aria-hidden`. Form errors associated with fields via `aria-describedby` + error summary with focus. |
| **P1-07** Unique metadata per core page | High | ✅ FIXED | `scripts/prerender.mjs:65-110` `HEAD` map sets unique `<title>` + `<meta description>` + canonical URL + `og:url` per route. Client-side `document.title` set in each page's `useEffect` matches the prerendered HTML. |
| **P1-08** Explain proprietary data-confidence model | High | ✅ FIXED | `MethodologyPublic.tsx:201-205` amber callout: "Eco-Auditor data-confidence score. This score is an internal, proprietary decision-support indicator — not an assurance opinion and not a GHG Protocol certification." |
| **P1-09** Video fallback and reduced-motion | High | ✅ FIXED | `LandingPage.tsx:153-165` product video has `controls`, `preload="metadata"`, `poster="/og-image.png"`, `aria-describedby="product-video-description"`, VTT captions track (`<track kind="captions" src="/video/product-workflow.en.vtt" default />`), and a fallback `<p>` with links to `/demo` and `/methodology`. Hero background video is `aria-hidden="true"` decorative. |
| **P1-10** Claims register | High | ✅ FIXED | `src/content/claims.ts` with 8 claims, each carrying `owner`, `evidence`, `approved_surfaces`, `caveat`, `reviewed_at`, `review_due`, `status`. Unverified claims (consultant-cost, setup-time) flagged for removal/qualification. |
| **P1-11** Direct regulatory applicability | High | ✅ FIXED | `MethodologyPublic.tsx:139` SB 253 card: "California's first-year Scope 1 and Scope 2 reporting deadline is August 10, 2026, for covered entities… Smaller suppliers may still receive emissions-data requests from covered customers." CBAM card (`:150`) qualifies: "does not replace an authorized declarant, customs filing, legal review, or required verification." |
| **P1-12** Cookie-consent experience | High | ✅ FIXED | `CookieConsentBanner.tsx` — Reject and Accept equal prominence (both `btn` styled, side-by-side), preferences modal with per-category toggles, no dark patterns. `consent-context.ts` stores consent with version/timestamp. Footer "Cookie preferences" link reopens. |
| **P1-13** Brand and operator identity consistent | High | ✅ FIXED (this session) | Footer names operator: "Eco-Auditor, a product operated by Developer312, a subsidiary of NIGHT LITE USA LLC" (`Footer.tsx:59`). This session added Eco-Auditor-domain customer-facing emails (`support@`, `security@`, `privacy@ecoauditor.io`) to Footer + ContactUs, keeping `hello@developer312.com` as operational backstop. |

---

## 3. Items applied this session (FIX-NOW)

| Finding | File(s) changed | Change |
|---|---|---|
| P1-06 | `src/pages/ContactUs.tsx` | Removed orphan copyright card from right column (was duplicating global Footer in the accessibility tree). Decorative emoji icons marked `aria-hidden`. |
| P1-13 | `src/components/Footer.tsx`, `src/pages/ContactUs.tsx` | Added `support@ecoauditor.io`, `security@ecoauditor.io`, `privacy@ecoauditor.io` as primary customer-facing identities; kept `hello@developer312.com` as operational backstop. |
| Regression guard | `tests/contact-page.test.tsx` (new) | 5 tests asserting no duplicate copyright card + Eco-Auditor-domain emails present in ContactUs and Footer. |

---

## 4. Items deferred to HUMAN (never-auto-apply)

### LEGAL-1 (P0-02) — Public "business draft for review" banner  · owner: Legal  · CRITICAL

The only remaining Critical UI/UX blocker. All three legal pages
(`TermsOfService.tsx`, `PrivacyPolicy.tsx`, `DataProcessingAddendum.tsx`)
still display an amber "business draft for review" banner. The placeholder
*tokens* (TBD, [Date to be set], etc.) are already gone, but the banner
sentence itself signals "not commercially ready" to procurement/legal buyers.

Per the SaaS launch audit skill §3 Phase-4 rules, legal content is in the
never-auto-apply domain. The existing `scripts/check-legal-placeholders.mjs`
comment intentionally preserves the banner for exactly this reason. The
proposed minimal diff and acceptance criteria are documented in
`HUMAN_ACTIONS.md` under `LEGAL-1`.

**Why this gates the verdict:** the audit skill's full MVP launch gate
condition 16 requires "No known launch-blocking broken control, dead-end,
placeholder, or misleading product state." A publicly-displayed draft banner
on the legal pages is a misleading product state for a paid B2B SaaS. Until
counsel signs off and the banner is removed, the verdict stays
`CONDITIONALLY LAUNCHABLE`, not `LAUNCHABLE`.

---

## 5. Verification evidence

| Check | Command | Result |
|---|---|---|
| Legal placeholder tokens | `node scripts/check-legal-placeholders.mjs` | PASS — "no banned placeholders found." |
| Type-check | `npx tsc -b` | PASS — no output (success) |
| Unit + integration tests | `npx vitest run` | PASS — 161/161 (before session) → 166/166 (after adding 5 contact-page tests) |
| New regression test | `npx vitest run tests/contact-page.test.tsx` | PASS — 5/5 |
| Sample report downloads | `Get-ChildItem public/sample-report` | 4 files present (PDF + 3 CSVs) |

---

## 6. What still needs a real-browser pass (audit skill §6)

The audit skill requires runtime evidence for claims that static analysis
cannot prove. These were not verified this session and should be run before
the launch verdict is finalized:

- [ ] Playwright route tests: `/login` and `/signup` render auth forms (not homepage content) — audit P0-01 acceptance criteria.
- [ ] Playwright pricing test: plan selection persists into signup (`/signup?plan=starter&billing=annual`) — audit P0-01.
- [ ] Keyboard-only pass on critical flows (login, signup, contact, demo forms) — audit §10.
- [ ] Screen-reader smoke test (NVDA or VoiceOver) on legal pages and pricing.
- [ ] Mobile reflow at 320 CSS px and 200% zoom — audit §10 Visual.
- [ ] `curl -sS -D - "$APP_URL/"` security-header + canonical verification against deployed SHA.
- [ ] Core Web Vitals measurement (LCP/INP/CLS) on homepage, pricing, sample-report.

These are `UNVERIFIED` in this report because they require a running build
and browser automation against the deployed URL — out of scope for an
in-repo FIX pass.

---

## 7. Recommended next actions

1. **Legal counsel reviews Terms/Privacy/DPA** → removes the "business draft
   for review" banner per `LEGAL-1` in `HUMAN_ACTIONS.md`. This is the only
   remaining Critical blocker.
2. **Run the Playwright route + accessibility suite** against the deployed
   site to convert the `UNVERIFIED` runtime claims in §6 to `PASS`.
3. **Resolve the `unverified` claims in `claims.ts`** (consultant-cost-comparison,
   setup-time) — either source them or remove the copy.
4. **Confirm `trustFacts.cloudHosting` and `backupsDeletionWindowDays`** with
   infrastructure owner and flip `verified: false → true` once evidence exists.