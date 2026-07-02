# EcoAuditor.io — MVP Audit Report

**Date:** 2026-07-01
**Auditor:** Multi-agent code + UX audit (Fable fleet, Opus synthesis)
**Scope:** Full codebase audit against marketing claims, paid feature verification, UX/UI review
**Repo:** eco-auditor-deploy @ `224d8f1`

---

## Executive Summary

**6 of 9 product pages are mock-data facades.** The calculator CRUD, dashboard summary API, CSV parsing engine, and Stripe checkout/portal/webhook verification are real. Reports, Ledger, Suppliers, Settings, AI Assistant, and PDF generation are non-functional or hardcoded. There is **zero plan enforcement** — free/expired users access everything. The calculator→dashboard data pipeline is numerically incompatible and will 500 or produce wrong numbers. Analytics fire before consent (GDPR breach). The entire app is unusable on mobile (no navigation).

**Verdict:** Not shippable for paid customers. Fix the 13 CRITICAL items before accepting money.

---

## CRITICAL (13 issues) — Must fix before launch

### C1. No plan enforcement anywhere
**Files:** `server.cjs` (all API routes), `src/components/UpgradePrompt.tsx`
**Problem:** No API route checks subscription tier. `/api/trial-status` (line 183) fails open (`trial: true` on error). `UpgradePrompt.tsx` is never imported by any page. Free/expired users access everything paid users get.
**Fix:** Add middleware that reads user's Stripe subscription status from DB, gate routes by tier. Import and render `UpgradePrompt` on gated pages.

### C2. Webhook handler does nothing — subscriptions never persist
**File:** `server.cjs:505-523`
**Problem:** All Stripe webhook events (`checkout.session.completed`, `subscription.updated/deleted`, `invoice.paid/failed`) only `console.log()`. Subscription state is never written to the database. A user can pay and receive nothing; a cancelled subscriber loses nothing.
**Fix:** Implement handlers that upsert `users.stripe_subscription_id`, `plan_tier`, `subscription_status`, `trial_ends_at` columns.

### C3. Calculator → Dashboard data pipeline is broken
**Files:** `src/components/carbon-calculator/index.tsx:91-104`, `server.cjs:945-947`, `emissions-engine.cjs:94-97,115-134`
**Problem:** Calculator stores pre-calculated kg CO2e with `unit: 'kg CO2e'`. Dashboard re-runs `calculateEntry()` expecting raw amounts + known source/unit keys. `SCOPE1_FACTORS['natural_gas']['kg_co2e']` doesn't exist → `factorForEntry` throws → summary 500s or double-multiplies.
**Fix:** Either store raw amounts and let the engine calculate, or skip recalculation for entries already in kg CO2e.

### C4. CSV import doesn't persist
**File:** `server.cjs:1071`
**Problem:** `/api/ingest/csv` pushes rows into in-memory `sampleEmissionEntries` array, never Postgres. In production `allowSampleData()` is false → imported rows never appear and vanish on restart.
**Fix:** Insert parsed rows into the emissions table via Drizzle/pg.

### C5. CSV upload is unauthenticated from client
**File:** `src/pages/DataIntake.tsx:91-95`
**Problem:** Calls `/api/ingest/csv` with no `Authorization` header. With `INSFORGE_BASE_URL` set, `apiAuthGuard` returns 401.
**Fix:** Use `buildApiRequestInit()` or pass the bearer token like other authenticated requests.

### C6. Analytics fire before/without consent (GDPR breach)
**Files:** `index.html:4-12`, `src/main.tsx:11-13`, `src/lib/gtm.ts:32-51`
**Problem:** `index.html` hardcodes gtag.js and fires `gtag('config')` unconditionally. `initializeGTM()` injects the GTM container before consent. Two parallel stacks (GA4 + GTM) likely double-count page views. Cookie banner only gates custom `dataLayer.push`.
**Fix:** Remove the hardcoded gtag script from `index.html`. Gate `initializeGTM()` behind consent. Use a single tracking stack.

### C7. No mobile navigation (marketing or app)
**Files:** `src/components/Header.tsx:124` (marketing), `src/App.tsx:150,208-211` (app shell)
**Problem:** Marketing nav is `hidden md:flex` with no hamburger. App sidebar is `hidden md:flex` with no drawer. Mobile users cannot reach any page except what's visible on their current screen.
**Fix:** Add a hamburger menu / mobile drawer to both Header and the app shell sidebar.

### C8. AI Assistant is fake
**File:** `src/pages/AIAssistant.tsx:33-46`
**Problem:** Explicit `// TODO: Replace with live insforge.ai.chat()`. Returns one hardcoded canned response after 1.5s delay for every question. Page claims "Powered by GHG Protocol methodology."
**Fix:** Wire to a real LLM endpoint or remove the page from navigation until implemented. Remove false methodology claim.

### C9. Reports page is 100% mock
**File:** `src/pages/Reports.tsx`
**Problem:** Renders `REPORTS` from mockData. "New Report", "Edit", "Export PDF" buttons have no handlers. CBAM package is hardcoded.
**Fix:** Wire to `/api/reports` endpoints. Implement the server-side PDF generation that already partially exists (`server.cjs:1159-1182`).

### C10. Ledger is 100% mock
**File:** `src/pages/Ledger.tsx`
**Problem:** Renders `LEDGER_ENTRIES` from mockData. "87% defensible" badge, Export/Approve/Flag buttons are static. Marketed as an "immutable audit trail."
**Fix:** Wire to real emission entry data with actual audit status tracking.

### C11. Suppliers page is 100% mock
**File:** `src/pages/Suppliers.tsx`
**Problem:** All data from `SUPPLIERS` mock. Send Questionnaire / Nudge / Follow Up buttons are no-ops.
**Fix:** Wire to a real suppliers table or remove from navigation until implemented.

### C12. Subscription change & cancel are 501 stubs
**File:** `server.cjs:375-394`
**Problem:** `PATCH /api/subscription` and `DELETE /api/subscription` return 501. Settings' "Change plan" and "Cancel" buttons always fail. Only portal works.
**Fix:** Implement via Stripe API, or route users to the billing portal (which already works at `POST /api/portal`).

### C13. Checkout env vars undocumented — likely dead in deploy
**Files:** `server.cjs:421-428`, `.env.example`
**Problem:** Checkout requires 7+ env vars (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VITE_STRIPE_PK`, 6 price IDs). `.env.example` has no Stripe vars. If unset, every checkout returns 400.
**Fix:** Add all Stripe vars to `.env.example` with clear documentation.

---

## HIGH (12 issues) — Fix before accepting paid customers

### H1. Price mismatch across three sources
**Files:** `src/data/mockData.ts:212-267`, `src/pages/Pricing.tsx:12-14`, `server.cjs:573,605`
**Problem:** mockData says Starter $149 / Growth $399 / Pro $999. SEO schema says $49/$149/$499. Chatbot quotes $49/$149. Google indexes wrong prices.
**Fix:** Single source of truth for plan pricing. Derive SEO schema and chatbot responses from it.

### H2. "Start free trial" silently charges annual users
**Files:** `src/pages/Pricing.tsx:21,125`, `server.cjs:431-434`
**Problem:** Pricing defaults to annual billing. `TRIAL_ELIGIBLE_PLANS` only contains monthly price IDs. Annual "Start free trial" creates a no-trial Stripe session — user is charged immediately.
**Fix:** Add annual price IDs to `TRIAL_ELIGIBLE_PLANS`, or disable trial CTA on annual toggle.

### H3. Settings shows fabricated billing data to every user
**File:** `src/pages/Settings.tsx:44-45`, `src/data/mockData.ts:276-300`
**Problem:** Hardcoded `BILLING_SUBSCRIPTION` (Growth annual, active), fake invoices, fake Visa ••••4242. Free users see themselves as paying customers.
**Fix:** Fetch real subscription data from Stripe via API.

### H4. Fabricated social proof on landing page
**File:** `src/pages/LandingPage.tsx:164,275-284,182-197`
**Problem:** Fake company logos ("Northstar Foods"), fake testimonials ("That contract was worth $2M"), fake metrics ($84K savings). Legal liability for a beta product.
**Fix:** Remove fake logos/testimonials or replace with "illustrative" disclaimer. Use real metrics or remove.

### H5. No error boundary anywhere
**Problem:** Zero `ErrorBoundary` or `componentDidCatch` in `src/`. Any render exception = permanent white screen.
**Fix:** Add a root error boundary in `App.tsx` with a "Something went wrong" fallback.

### H6. Auth guard never re-validated after initial check
**File:** `src/App.tsx:77-101`
**Problem:** Checks `getCurrentUser()` once. Session expiry mid-use is never detected — no 401 interceptor, no interval, no auth listener.
**Fix:** Add a 401 response interceptor that redirects to login. Optionally poll session validity.

### H7. No 404 handling
**File:** `src/App.tsx:267, 238-249`
**Problem:** Public `*` silently redirects to `/`. App `/app/*` has no catch-all — renders empty shell.
**Fix:** Add a 404 page component for both public and app routes.

### H8. Marketing pages missing Footer
**Files:** `MethodologyPublic.tsx`, `SampleReport.tsx`, `Security.tsx`
**Problem:** No `<Footer />` import or render. Visitors get no legal links, contact info, or cross-navigation.
**Fix:** Add `<Footer />` to all marketing page layouts.

### H9. Contact form depends on unconfigured backend
**File:** `src/pages/ContactUs.tsx:15-19`
**Problem:** If InsForge `contact_submissions` table lacks public insert RLS or backend isn't configured, form errors with "backend not configured" shown to end users.
**Fix:** Add a mailto fallback or verify RLS configuration.

### H10. Off-brand contact identity
**Files:** `src/components/Footer.tsx:57-75`, `src/pages/ContactUs.tsx:47,67-68`
**Problem:** `hello@developer312.com` and "Developer312 / NIGHT LITE USA LLC" everywhere. No ecoauditor.io email. Undermines trust for a compliance product.
**Fix:** Use `hello@ecoauditor.io` or similar branded address.

### H11. Dashboard shows hardcoded "Northstar Foods" company name
**File:** `src/App.tsx:213-215`
**Problem:** Breadcrumb "Northstar Foods / FY 2026" and fake notification bell with "1 unread alert" — every real user sees another company's name.
**Fix:** Read company name from auth context / API.

### H12. Consent storage not validated on policy version bump
**File:** `src/lib/consent-context.tsx:45-56`
**Problem:** `readConsentFromStorage` never compares `policyVersion`. Bumped policy won't re-prompt users.
**Fix:** Check stored `policyVersion` against current; invalidate if mismatched.

---

## MEDIUM (14 issues) — UX improvements

| # | Issue | File(s) | Fix |
|---|-------|---------|-----|
| M1 | Client/server emission factors disagree (kg vs tonnes, different category keys) | `utils.ts` vs `emissions-engine.cjs` | Unify factor source; derive client factors from engine |
| M2 | Settings is display-only — edit fields have no save handler | `Settings.tsx:74-89` | Wire save to API or disable editing |
| M3 | Data Intake Approve/Review buttons fake success with `setTimeout` | `DataIntake.tsx:41-74` | Wire to real API or show "coming soon" |
| M4 | File input accepts xlsx/pdf/png but only CSVs are processed | `DataIntake.tsx:84` | Restrict accept to `.csv` or implement other parsers |
| M5 | AuthCallback shows spinner even when error is set | `AuthCallback.tsx:36` | Conditionally render error state |
| M6 | Add-on "Add" buttons are dead (no onClick) | `Pricing.tsx:164` | Wire to checkout or remove |
| M7 | "Book demo" / "Talk to sales" buttons are dead | `Pricing.tsx:134,213-214`, `LandingPage.tsx:91` | Link to Calendly/contact or remove |
| M8 | Two competing onboarding paths (calculator vs server auto-provision) | `Onboarding.tsx` vs `server.cjs:292-325` | Consolidate into one flow |
| M9 | Calculator ignores selected unit when calculating | `utils.ts:108-114` | Key factor lookup by source + unit |
| M10 | Trend endpoint only covers Jan–Sep, Q4 data dropped | `server.cjs:963` | Extend to 12 months |
| M11 | Two autoplaying videos on landing double bandwidth | `LandingPage.tsx:64-73,144-154` | Lazy-load with `preload="none"` + poster |
| M12 | Sticky nav collision on Methodology page | `MethodologyPublic.tsx:112` | Offset `top` to account for Header height |
| M13 | Form inputs lack label association (accessibility) | `ContactUs.tsx:89-115` | Add `htmlFor`/`id` pairing |
| M14 | Theme flash (FOUC) for dark mode users | `src/hooks/useTheme.tsx:23-26` | Add inline script in `index.html` to set `dark` class pre-render |

---

## LOW (10 issues) — Nice-to-haves

| # | Issue | File(s) |
|---|-------|---------|
| L1 | Duplicate Footer columns ("Company" and "Contact") | `Footer.tsx:52-70` |
| L2 | Two different logo SVGs (Header vs Footer) | `Header.tsx:50-57`, `Footer.tsx:13-23` |
| L3 | Chatbot hands out hardcoded Railway PrismDeck URL | `server.cjs:662` |
| L4 | No route-level code splitting — all pages statically imported | `App.tsx:7-29` |
| L5 | Duplicate `<link rel="manifest">` | `index.html:59-60` |
| L6 | `insforge.ts:13` falls back to `http://localhost:54321` in prod | `src/lib/insforge.ts:13` |
| L7 | GTM ID hardcoded fallback defeats env override | `src/lib/gtm.ts:4` |
| L8 | Cookie banner uses `green-600`/`gray-*` instead of `brand`/`surface` tokens | `CookieConsentBanner.tsx:27` |
| L9 | Suite links lack `target="_blank" rel="noopener"` | `Footer.tsx:82-84` |
| L10 | Weak password policy (6 chars, no complexity) | `Signup.tsx:171-181` |

---

## What's Working Well

- **Calculator CRUD** via InsForge — form captures scope/category/source/amount, writes to DB
- **Emissions engine** (`emissions-engine.cjs`) — real EPA factors, 11 categories, 50+ sources
- **Dashboard summary + trend APIs** — real server-side aggregation
- **Stripe checkout flow** — real code path with allowlisted price IDs, signature-verified webhooks
- **Billing portal** — `POST /api/portal` is functional
- **Auth flow** — email login/signup with loading states, inline errors, verification-pending screen
- **Social auth** — Google/Microsoft/Apple wired via InsForge OAuth
- **Security headers** — CSP, HSTS, X-Frame-Options properly set
- **Rate limiting** — sliding window, IP-based, trust proxy configured
- **SEO groundwork** — JSON-LD, OG tags, sitemap, robots.txt, prerendered marketing routes
- **Lead capture chatbot** — salesbot with canned responses and lead persistence

---

## Recommended Fix Order

### Phase 1: Stop the bleeding (week 1)
1. **C6** — Remove hardcoded analytics, gate behind consent (legal risk)
2. **C7** — Add mobile navigation (app is unusable on phones)
3. **H4** — Remove fake social proof (legal liability)
4. **H11** — Replace hardcoded "Northstar Foods" with real company name
5. **H5** — Add error boundary

### Phase 2: Make billing work (week 2)
6. **C2** — Implement webhook handlers to persist subscriptions
7. **C1** — Add plan enforcement middleware
8. **C13** — Document and verify all Stripe env vars
9. **H2** — Fix trial-on-annual charging bug
10. **H1** — Fix price inconsistencies
11. **H3** — Replace mock billing data in Settings with real Stripe data

### Phase 3: Fix the core product pipeline (week 3)
12. **C3** — Fix calculator → dashboard data incompatibility
13. **C4** — Persist CSV imports to Postgres
14. **C5** — Add auth header to CSV upload
15. **M1** — Unify client/server emission factors

### Phase 4: Ship or gate incomplete features (week 4)
16. **C8** — Wire AI Assistant to real LLM or remove from nav
17. **C9** — Wire Reports to real data or gate behind "coming soon"
18. **C10** — Wire Ledger to real data or gate behind "coming soon"
19. **C11** — Wire Suppliers to real data or gate behind "coming soon"
20. **C12** — Implement subscription change/cancel or route to portal

### Phase 5: Polish (ongoing)
21. Remaining HIGH and MEDIUM items from lists above

---

*Generated by multi-agent audit fleet. Verify each finding against current deploy before acting.*
