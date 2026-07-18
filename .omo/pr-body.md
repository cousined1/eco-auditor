# P0 launch-blocker fixes — Eco-Auditor MVP

Resolves the 6 P0 + 4 additional-finding issues from `ecoauditor-ui-ux-mvp-audit-2026-07-11.md`. Orchestration: **godmythos-v10.6** (TO_WEBSITE ship contract) doctrine + **fable-mode** (stage map → failable checks → self-critique → fresh-context verifier) + **fusion-3** panel for load-bearing facts. All implementation/review/test/commit work ran on **fable-5** agents (architect, code-reviewer, test-engineer, debugger, git-master).

## Fusion-3 provenance
- **Intended panel** `opus4.8-gpt5.6-gemini3.1pro`; **actual (degraded)** `opus4.8-gpt5.6` — Gemini 3.1 Pro dropped after retry (`agy --print` did not capture a response). Opus 4.8 judged the two surviving plans blind and synthesized one merged plan. Gemini-family cross-check unavailable (coverage gap documented in `.omo/fusion3-provenance.md`).
- **Web-verified facts** (`.omo/fusion3-verified-facts.md`) override any panelist claim:
  - **eGRID2023** (data year 2023, published 2025-01-15) is still latest as of July 2026 — **eGRID2024 was NOT released**. "eGRID 2022" and "keep 2024 verified:true" proposals rejected.
  - **EPA GHG Emission Factors Hub 2025** (data year 2024) is latest. Both encoded `verified:true`.
  - `backupsDeletionWindowDays = 30 verified:false` (NOT 35 — 35 is in no source file).
  - `cloudHosting = 'VERIFY' verified:false` (NOT 'Railway' — fabricating a host violates §3).
  - **Model B** adopted (fix copy to match existing card-backed auto-charge Stripe wiring — zero billing-code change).

## Commits (atomic per P0)
```
0d53c89 fix(trust): drop provider-name literal from cloudHosting note (P0-06 follow-up)
aec723c fix(web): prerender auth, health, CTAs, per-route meta (P0-01, AF-2/3/4)
04e32dc fix(billing): Model B copy + pricing single-source (P0-05, AF-1)
e0884f1 fix(trust): trust-facts registry + overclaim softening (P0-06)
076dee3 fix(emissions): verified factor registry, no hardcoded years (P0-04)
9181394 fix(reports): correct SampleReport primaryOrBetter 83%->42% (P0-03)
4139be5 fix(legal): launch-gate guardrail for bracketed placeholders (P0-02)
```

## What changed

| ID | Fix | Failable evidence |
|---|---|---|
| **P0-01** | `/login`,`/signup` prerendered (own HTML, not the homepage), `noindex` (server-side prerender + client-side `useEffect`), `robots.txt /signup`, SPA fallback preserved, Signup plan-aware `?plan=` (allowlist-validated) → `/app?checkout=` | `static/login\|signup/index.html` exist with distinct titles + `noindex,nofollow`; `routes-prerender.test.ts` (8 cases) |
| **P0-02** | Legal-placeholder launch-gate guardrail (`scripts/check-legal-placeholders.mjs`) wired into `npm run build` (exits 1 on bracketed placeholders; preserves "business draft for review" banners); `build:skip-legal` for dev | `npm run build` **correctly fails** with 11 matches; `build:skip-legal` passes |
| **P0-03** | `summarizeQuality()` (null-safe, `scores[i]?.score ?? 0`) replaces hand-written 83% → renders **42% primaryOrBetter / 17% estimated** | `quality-summary.test.ts` asserts 42/83/17/100; no hand-written "83%" |
| **P0-04** | Emission-factor registry (`epa-egrid-2023`, `epa-efh-2025` both `verified:true`); `factorLabel()` returns "(verify before publication)" for missing/unverified; `mockData` + `MethodologyPublic` + `Methodology` use it | `grep "eGRID 2024\|GHG Factor Hub 2024" src/ tests/` = 0 |
| **P0-05** | Model B copy ("14-day free trial · Card required to start · Cancel anytime"); "audit-ready"→"reviewable"/"defensible" across LandingPage/MethodologyPublic/Methodology/SampleReport/Pricing/Security/Footer/Dashboard + `index.html` OG/Twitter/JSON-LD + salesbot CBAM | `grep -rni "audit-ready\|no credit card\|Free tier"` = 0; "CBAM-compliant"→"CBAM-aligned" |
| **P0-06** | `trustFacts` with `verified` boolean + `renderFact` sentinel; overclaim softening ("Aligned with"/"Designed around"); "NoNDA"→"No NDA" | `grep "NoNDA\|GDPR compliant\|CCPA compliant"` = 0; trust-facts test asserts every fact carries `verified` |
| **AF-1** | `src/content/pricing.ts` single source of truth ($149/$399/$999) across Pricing UI/JSON-LD/meta/mockData-reexport/salesbot/homepage `AggregateOffer` (149/999) | `pricing.test.ts` asserts all surfaces derive from `pricing.ts`; no `$49` |
| **AF-2** | `/api/health` + `/health`: SHA from env (`RAILWAY_GIT_COMMIT_SHA‖VERCEL‖GIT_SHA‖null`), `Cache-Control: no-store` | live `curl` → 200 `sha:"verify999"` + `no-store`; `server-health.test.ts` |
| **AF-3** | Dead CTAs in `Pricing.tsx` wired to `<Link to="/contact">` | 3 CTAs at Pricing.tsx:144/223/224 |
| **AF-4** | Per-route `<title>` + `<meta description>` in prerendered static HTML (8 routes, differ from homepage) | `routes-prerender.test.ts` confirms |

## Verification (fresh-context verifier: VERIFIED → APPROVE)
- `npx vitest run` → **19 files / 145 tests / 0 failed**
- `npm run lint` → **0 errors**
- `npm run build:skip-legal` → **11 ok / 0 fail**
- `npm run build` → **intentionally fails** (P0-02 legal gate — 11 bracketed placeholders caught)
- All §3 greps → **0** (`audit-ready`, `compliant` adjective-assertions, `NoNDA`, `GDPR/CCPA compliant`, `eGRID 2024`, `$49`, `no credit card`, `Free tier`, `Railway`, `35-day`)
- Live `/api/health` → 200 + `sha` from env + `Cache-Control: no-store`

## Known limitations (self-critique)
1. **Gemini coverage gap** — fusion-3 ran 2-of-3 model families (Opus + GPT-5.6); Gemini cross-check unavailable.
2. **Whole-file commit granularity** — `git add -p` hunk staging unavailable in the build env, so files spanning multiple P0s (`server.cjs`, `Pricing.tsx`, `mockData.ts`, `Signup.tsx`, `index.html`) were committed in their primary P0 with cross-cuts noted in the commit body.
3. **Billing checkout is a half-wire (by scope)** — P0-01 delivers the Signup→`/app?checkout=` redirect (secure, allowlist-validated) but no code in `/app`/Dashboard reads the param yet. Wiring the `createCheckoutSession` trigger on the app side is a follow-up (billing checkout is a separate feature, out of this P0 set's scope).
4. **AF-1 salesbot not DRY-imported** — `server.cjs` (CommonJS) cannot import `pricing.ts` (ESM-TS) without a build-step refactor; values are consistent today and `pricing.test.ts` guards the `$49` regression. Left as a known limitation.

## Launch-readiness checklist — items left for HUMAN verification
These are intentionally **not fabricated**; the code marks them `verified:false` / sentinel / launch-gate so they surface here rather than ship as false facts:

1. **Legal counsel (P0-02)** — bracketed placeholders in `TermsOfService.tsx:49,166,186,187`, `PrivacyPolicy.tsx:58`, `DataProcessingAddendum.tsx:50` must be replaced by qualified legal review before `npm run build` passes. "business draft for review" banners stay until sign-off. Operator entity (NIGHT LITE USA LLC) is named, not a placeholder.
2. **Deploy/hosting target (P0-06)** — `cloudHosting='VERIFY'`; code says AWS, DPA says generic. Confirm Railway vs AWS, then flip `verified:true`.
3. **Stripe config (AF-1)** — reconcile the $149/$399/$999 amounts in `pricing.ts` against actual Stripe price IDs/env vars. `priceIdEnv` holds env-var **names** only.
4. **Backup retention (P0-06)** — `backupsDeletionWindowDays=30 verified:false`; code says "30-day retention". Ops to confirm the real window.
5. **Subprocessors (P0-06)** — all subprocessor entries except Stripe are `verified:false` with `processingRegion:'VERIFY'`/`dpaUrl:null`. Confirm vendor DPAs + regions.
6. **Billing checkout consumer (P0-01 follow-up)** — wire `/app`/Dashboard to read `?checkout=` and trigger `createCheckoutSession`.
7. **"Up and running quickly" (P0-05)** — softened from "under 10 minutes"; confirm if a specific verifiable time claim is desired.
8. **Gate 13 / post-deploy smoke** — `/api/health` now exists to support F1 SHA-verification, but the Cypress post-deploy smoke harness (godmythos `WO-CYPRESS-SMOKE-HARNESS`) is not yet implemented.

## Hard constraints honored (§3)
- No invented legal values (operator entity, liability caps, jurisdiction, dispute mechanism, effective dates).
- No fabricated subprocessor regions/DPA URLs/hosting identity; unverified → "(verify before publication)".
- Compliance wording uses "supports"/"maps to"/"designed around"/"aligned with" — never "GDPR/CCPA compliant"/"audit-ready"/"compliant" as assertions; SOC 2 "in progress" only.
- eGRID2023 + EPA GHG Factor Hub 2025 both `verified:true`; no "eGRID 2024" as fact.
- No Stripe price IDs/secrets hardcoded; `?plan=` validated against an allowlist before URL interpolation.
- Tailwind 3.4 LOCKED (package.json:36) — no v4, no new CSS framework.

🤖 Generated with [Claude Code](https://claude.com/claude-code)