# EcoAuditor.io — MVP Audit Report (Follow-up)

**Date:** 2026-07-06  
**Method:** Gated multi-agent audit — 12 `fable` agents (regression + 8-dimension fresh sweep), Opus synthesis & adjudication  
**Predecessor:** [ECOAUDITOR-MVP-AUDIT-2026-07-01.md](ECOAUDITOR-MVP-AUDIT-2026-07-01.md) — this pass re-verifies every prior finding against current code and adds newly discovered issues.  
**Build baseline (verified):** `vitest` 109/109 pass · `eslint` clean · `tsc -b` clean

> ⚠️ The green build masks the real risk surface. Most defects are **runtime / functionality-vs-claims** issues that unit tests never exercise (e.g. broken client billing token, unpersisted CSV, false marketing claims).

---

## ✅ Fixed in PR `audit/mvp-fixes-2026-07-06` (commits a70f87e · 034f5a1 · 457b2a1)

All green after each commit: `tsc -b` clean · `eslint` clean · **111/111 tests** (+2 pipeline regression tests).

**Critical / code correctness**
- **C3** calculator→dashboard pipeline — kg/t CO2e passthrough (no more 500s / ~217× inflation).
- **C4** CSV imports now persist to Postgres (transactional batch insert, scope mapping, facility resolution, row-date → `created_at`, DB-failure = 500 not false success).
- **C5** CSV upload sends the auth token (was 401ing every prod upload).
- **Client billing token** — `getAuthToken()` was silently dead for every signed-in user; now reads the SDK's managed header.
- **`users` billing table** — added the migration every Stripe route/webhook depended on.
- **C1** plan enforcement extended to core routes (`/api/calculate`, emissions summary/trend, facility create, compliance sign-off) — expired/free users now hit the 402 paywall.
- **H2** annual "Start free trial" no longer charges immediately (trial gated to monthly billing).

**Honesty / UX / a11y**
- **H11/#43** Dashboard no longer shows fabricated Northstar/CFO/readiness/alerts/tasks mock data (keeps real emissions widgets; dynamic fiscal year).
- Compliance deadlines derive overdue/due_soon/upcoming from the date.
- Cookie banner a11y (dropped page-inert `aria-modal`, labelled checkboxes, tokens); Settings fake webhook panel + misleading copy removed; ContactUs mailto fallback + dedup; Login/Signup redirect-if-authed, `role=alert`, stronger password policy; footer dedup/logo/`rel=noopener`; dup manifest / broken icon / dark-mode FOUC.
- Public brand shown as **EcoAuditor**; working contact email kept as `hello@developer312.com`; legal entity (Developer312/NIGHT LITE) unchanged in Terms/Privacy/DPA.

**Deliberately left for you (product/legal/DB-schema judgment):** false marketing/methodology/security claims (AI-OCR extraction, immutable audit trail, SSO/RBAC, SB253/CBAM packages, XBRL exports), price reconciliation across SEO/FAQ/chatbot, `authGuard` endpoint contract, report/PDF end-to-end, facility DB persistence, session re-validation, and the 402 client-side upgrade UX (`UpgradePrompt`). See findings below.

---

## Executive Summary

This follow-up audit finds **97 actionable issues** (107 total incl. verified-fixed).

| Severity | Total | Actionable (not yet fixed) |
|---|---|---|
| CRITICAL | 16 | 11 |
| HIGH | 27 | 23 |
| MEDIUM | 41 | 41 |
| LOW | 23 | 22 |

### Regression scorecard vs 2026-07-01 audit
Of the 49 prior findings: **13 verified FIXED**, **7 PARTIAL**, **29 still OPEN**.

**✅ Confirmed fixed since last audit:** C12, C2, C7, C8, C9, H11, H12, H5, H7, L6

The prior audit's top-line "6 of 9 pages are mock facades" has been *partially* addressed by gating fake features (AIAssistant, Reports, Ledger, Suppliers) behind honest "Coming Soon" screens, adding a mobile nav, an error boundary, 404s, and real Stripe subscription mutations. **However, the core data pipeline (calculator→dashboard→CSV→reports) and the billing persistence layer are still broken, and the marketing site makes numerous claims no code backs.**

### The five things to fix first
- **[C3] Fix calculator→dashboard pipeline: pre-calculated kg entries 500 the summary API or inflate totals** — `src/components/carbon-calculator/index.tsx`
- **[C4] Persist CSV imports to Postgres — paid imports currently vanish** — `server.cjs`
- **[C5] Add Authorization header to the CSV upload — Data Intake 401s for every real user** — `src/pages/DataIntake.tsx`
- **[H1] Reconcile three contradictory price sets — SEO/FAQ/chatbot advertise one-third of real checkout prices plus a nonexistent free tier** — `src/pages/Pricing.tsx`
- **[H2] Stop charging annual 'Start free trial' users immediately — wire the dead trialEligiblePriceIds helper** — `server.cjs`
- **[C1] Extend plan enforcement beyond 2 routes — expired/free users keep the core product; Growth/Pro unlock nothing** — `server.cjs`

---

## 🔴 CRITICAL (16)

### C1. Fix calculator→dashboard pipeline: pre-calculated kg entries 500 the summary API or inflate totals
**🔴 OPEN** · C3 · owner: `opus` · effort: M · category: pipeline  
**File:** `src/components/carbon-calculator/index.tsx:93`
**Claim it contradicts:** 'Executive Dashboard — Total emissions, scope breakdown at a glance'; calculator entries feed the dashboard  

**Problem:** The calculator persists pre-computed kg CO2e as amount with unit 'kg CO2e' (raw activity stashed in the TEXT factor column), but the server re-runs calculateEntry() on those rows: Scope 1/3 entries throw and 500 /api/emissions/summary, /api/emissions/trend, and report generation, while Scope 2 entries are silently re-multiplied by an eGRID factor (~217x inflation).

**Evidence:** index.tsx:93-104 inserts amount: data.calculatedKg, unit: 'kg CO2e', factor: `${data.amount} ${data.unit}`. Server loads the same table (server.cjs:1077-1085) into summarizeEntries → calculateEntry → factorForEntry: SCOPE1_FACTORS['natural_gas']['kg_co2e'] is undefined → throws 'Unsupported Scope 1 source/unit' (emissions-engine.cjs:94-97) → 500 (server.cjs:1182-1185). Scope 2 does NOT throw: unit 'kg_co2e' ≠ 'kwh' → treated as MWh and multiplied by a grid factor again (emissions-engine.cjs:101-107) — 417 kg CO2e becomes ~90.4 tCO2e. Frontend sources like 'Fuel Oil' and categories 'Process/Fugitive Emissions' have no engine key at all.

**Fix:** Store raw activity data (scope, category, source, amount, real unit) and let the server engine compute CO2e on read, OR add a passthrough branch in calculateEntry for unit 'kg CO2e'/method 'precalculated' (co2e_tonnes = amount/1000, factor 1, no lookup). Add a regression test with a calculator-shaped row.

---

### C2. Persist CSV imports to Postgres — paid imports currently vanish
**🔴 OPEN** · C4 · owner: `opus` · effort: M · category: pipeline  
**File:** `server.cjs:1302`
**Claim it contradicts:** Ingest response 'status: completed, imported: N' implies durable import; 'CSV & document intake' (landing)  

**Problem:** POST /api/ingest/csv — a plan-gated paid route — pushes parsed rows only into the in-memory sampleEmissionEntries array and never INSERTs into emission_entries, so in any DB-backed deployment the 'imported N rows' success is a lie: the data never reaches the dashboard and is lost on restart.

**Evidence:** server.cjs:1302-1305 `sampleEmissionEntries.push.apply(sampleEmissionEntries, entries); emissionsSummaryCache.clear();` — no pgPool INSERT anywhere in the route (1233-1329). loadEmissionEntries reads Postgres when pgPool is set (server.cjs:1073-1101) and only falls back to the sample array when allowSampleData() is true, which is false in production (server.cjs:311-313). Facility name matching also uses in-memory sampleFacilities (server.cjs:1244). The route returns imported: N / status 'completed' (1307-1325) to a customer gated by requirePlan('starter') (1233).

**Fix:** Batch-INSERT validated entries into public.emission_entries via pgPool inside a transaction (mapping scope to the DB CHECK format, migrations/20260611141026_initial-schema.sql:29), resolve facility_name against loadFacilities(companyId), and keep the in-memory path only when allowSampleData() is true.

---

### C3. Add Authorization header to the CSV upload — Data Intake 401s for every real user
**🔴 OPEN** · C5 · owner: `fable` · effort: S · category: auth  
**File:** `src/pages/DataIntake.tsx:91`
**Claim it contradicts:** 'Upload, connect, and review emissions data sources' (Data Intake page)  

**Problem:** handleUpload POSTs to /api/ingest/csv with only a Content-Type header; the route requires apiAuthGuard + requirePlan('starter'), so with INSFORGE_BASE_URL configured every production upload is rejected 401 before parsing.

**Evidence:** DataIntake.tsx:91-95 `fetch('/api/ingest/csv', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: text })` — no bearer token. server.cjs:1233 mounts apiAuthGuard + requirePlan; apiAuthGuard delegates to authGuard which 401s without a Bearer header (server.cjs:241-288). The dev fallback (no INSFORGE_BASE_URL) is why local dev and tests never notice. The fix helper already exists and is used by Dashboard.tsx:44-50 (buildApiRequestInit, src/lib/api.ts:7-13).

**Fix:** Build the request with buildApiRequestInit(insforge) and merge 'Content-Type': 'text/csv', mirroring Dashboard.tsx; handle 401 (session expired) and 402 (upgrade required) responses distinctly.

---

### C4. Reconcile three contradictory price sets — SEO/FAQ/chatbot advertise one-third of real checkout prices plus a nonexistent free tier
**🔴 OPEN** · H1 · owner: `fable` · effort: M · category: claims  
**File:** `src/pages/Pricing.tsx:12`
**Claim it contradicts:** Meta/JSON-LD: 'Free tier, Starter $49/mo, Growth $149/mo, Pro $499/mo'; FAQ '$49–$499/month'; chatbot 'Starter — $49/mo ... Enterprise — Custom pricing'  

**Problem:** The visible pricing cards charge $149/$399/$999 from mockData PLANS, while the JSON-LD schema, meta description, landing FAQ (text + JSON-LD), index.html AggregateOffer, and the server chatbot all advertise $49/$149/$499, a free tier, 'no credit card required', and a fictional Enterprise tier — Google rich results and the sales bot quote ~1/3 of the real price against a live checkout.

**Evidence:** mockData.ts:216,233,252 set monthly 149/399/999 (rendered Pricing.tsx:79-104, wired to Stripe checkout). Contradictions: Pricing.tsx:12-14 PRICING_SCHEMA offers '49'/'149'/'499'; Pricing.tsx:29 meta 'Free tier, Starter $49/mo ... no credit card required'; Pricing.tsx:10 'From free tier to enterprise-grade'; LandingPage.tsx:14,24 FAQ '$49–$499/month' (also in FAQ_SCHEMA); index.html:108-110 AggregateOffer lowPrice 0 / highPrice 499; server.cjs:805,837,941 chatbot 'Starter — $49/mo ... Growth — $149/mo ... Enterprise — Custom pricing'. No free plan exists (mockData.ts:212-267) and checkout collects a card (server.cjs:607-618).

**Fix:** Pick the canonical price list in one exported module and derive PRICING_SCHEMA, the meta description (also baked into prerendered static/pricing by scripts/prerender.mjs), LandingPage FAQ text + JSON-LD, index.html AggregateOffer, and the server.cjs ECOAUDITOR_KB pricing entries from it; delete 'Free tier'/'no credit card required'/'Enterprise' unless made true; verify env Stripe price IDs match the canonical amounts.

---

### C5. Stop charging annual 'Start free trial' users immediately — wire the dead trialEligiblePriceIds helper
**🔴 OPEN** · H2 · owner: `fable` · effort: S · category: billing  
**File:** `server.cjs:589`
**Claim it contradicts:** 'Start free trial' button on annual billing (the default toggle); 'No credit card required · 14-day free trial' (landing)  

**Problem:** Pricing defaults to annual billing with a 'Start free trial' CTA, but the checkout route grants trial_period_days only for the two MONTHLY price IDs, so annual signups are silently charged the full year immediately; the corrected helper including annual IDs was written in server-billing.cjs, imported, and never called.

**Evidence:** Pricing.tsx:21 useState<BillingCycle>('annual') default; :125-132 'Start free trial' passes plan.trial regardless of cycle. server.cjs:589-592 inline TRIAL_ELIGIBLE_PLANS contains only STRIPE_PRICE_STARTER_MONTHLY and STRIPE_PRICE_GROWTH_MONTHLY; :616-617 applies trial_period_days:14 only for that set. Smoking gun: server.cjs:25 imports trialEligiblePriceIds from server-billing.cjs (whose implementation at server-billing.cjs:39-46 DOES include annual IDs) but grep confirms it is never invoked. Additionally the session is mode:'subscription' with no payment_method_collection:'if_required' (server.cjs:607-618), so 'no credit card required' (LandingPage.tsx:95) is also false for the checkout path.

**Fix:** Replace the inline set at server.cjs:589-592 with trialEligiblePriceIds(process.env) in the :616 check; add a test that annual starter/growth checkouts get trial_period_days:14. Then either set payment_method_collection:'if_required' on trial sessions or remove the 'no credit card required' copy (the card-free path is only the in-app DB trial at server.cjs:336-338).

---

### C6. Extend plan enforcement beyond 2 routes — expired/free users keep the core product; Growth/Pro unlock nothing
**🟠 PARTIAL** · C1 · owner: `opus` · effort: L · category: billing  
**File:** `server.cjs:1233`
**Claim it contradicts:** Paid plans gate product features; Growth 'Scope 3 workflows, integrations', Pro 'API access, multi-entity' (mockData.ts:238-264)  

**Problem:** requirePlan() now exists but is attached to only 2 of ~12 data routes, both at the lowest tier ('starter'); dashboard summary/trend, calculate, facilities, compliance, and report download are ungated, so expired trials keep near-full access and no route anywhere enforces a growth/pro tier.

**Evidence:** grep requirePlan( in server.cjs: definition (:477) plus exactly two uses — POST /api/ingest/csv (:1233) and POST /api/companies/:id/reports/generate (:1391), both 'starter'. Ungated: POST /api/calculate (:1144), GET /api/emissions/summary (:1167), GET /api/emissions/trend (:1188), facilities routes (:1339,1346,1358), compliance routes (:1368,1374,1385), GET /api/reports/:id/download (:1406). hasPlanAccess/PLAN_ORDER (server-billing.cjs:48-53) is never invoked above 'starter'.

**Fix:** Apply requirePlan('starter') to /api/calculate, /api/emissions/*, facilities, compliance, and report download so an expired trial actually loses core access; map the sold feature matrix to requirePlan('growth')/'pro' gates as those features land.

---

### C7. Document the six STRIPE_PRICE_* env vars and APP_URL; kill the localhost success_url fallback
**🟠 PARTIAL** · C13 · owner: `fable` · effort: S · category: billing  
**File:** `railway.env.example:24`
**Claim it contradicts:** Checkout works when deployed per documentation  

**Problem:** Stripe secret/webhook/publishable keys are now documented, but the six price-ID env vars the code reads (plus DATABASE_URL and APP_URL) appear in no env example with correct names — a deploy following the docs yields 400 on every checkout, and with APP_URL unset, paying customers are redirected to http://localhost:3000 after paying.

**Evidence:** railway.env.example:24-33 documents only VITE_STRIPE_PK / STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET; .env.example has zero Stripe vars, no DATABASE_URL/APP_URL. Code requires STRIPE_PRICE_{STARTER,GROWTH,PRO}_{MONTHLY,ANNUAL} (server-billing.cjs:4-17; server.cjs:579-586 ALLOWED_PRICE_IDS) — unset means every checkout 400s 'Invalid price selection' (server.cjs:600-603) and /api/config/prices returns nulls (:559-576) → client 'Invalid plan selection' (stripe.ts:96-97). COPILOT-BUILD-GUIDE.md:301-306 documents wrong names (STRIPE_PRICE_ID_*) the code never reads. server.cjs:611-612 success_url/cancel_url and :635 portal return_url fall back to 'http://localhost:3000' when APP_URL is unset.

**Fix:** Add the six STRIPE_PRICE_* vars, DATABASE_URL, and APP_URL to both .env.example and railway.env.example; fix or delete the stale names in COPILOT-BUILD-GUIDE.md; log a startup warning (or 503 the route) when Stripe is configured but ALLOWED_PRICE_IDS is empty or APP_URL is missing in production, instead of defaulting to localhost.

---

### C8. Create the billing `users` table — no migration creates it, so all Stripe routes and webhook sync fail
**🆕 NEW** · owner: `opus` · effort: M · category: billing  
**File:** `server.cjs:370`
**Claim it contradicts:** Commit message: 'resolve launch-readiness P0 blockers — billing persistence'  

**Problem:** Every Stripe code path depends on a `users` table (insforge_user_id ↔ stripe_customer_id mapping) that no SQL migration creates and no deploy step applies — if absent in prod, checkout/portal/subscription endpoints 500 and every webhook returns 500, so subscription state is never persisted.

**Evidence:** server.cjs:370 `SELECT stripe_customer_id FROM users WHERE insforge_user_id = $1` and :390 `INSERT INTO users (...)` (ensureStripeCustomer, used by /api/checkout:605, /api/portal:631, PATCH/DELETE /api/subscription:518,539); server.cjs:425 syncSubscriptionRecord `SELECT insforge_user_id FROM users WHERE stripe_customer_id = $1` (webhook handler:672,681, failures 500 at :696). Verified: migrations/ contains only 3 SQL files creating companies/facilities/emission_entries/reports/contact_submissions/consent_records — no users table; it exists only in src/db/schema.ts:7-12 (drizzle) with no generated ./drizzle output, and deploy runs bare `node server.cjs` (Procfile, railway.toml:18) with no migrate/db:push step.

**Fix:** Add a raw SQL migration creating public.users (insforge_user_id UUID PRIMARY KEY, stripe_customer_id TEXT UNIQUE, email TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now()) matching src/db/schema.ts, index stripe_customer_id for webhook lookups, and add a migration-apply step to the deploy start command or CI.

---

### C9. Fix getAuthToken: insforge.auth.getSession() does not exist — every client billing action fails for signed-in users
**🆕 NEW** · owner: `fable` · effort: S · category: billing  
**File:** `src/lib/stripe.ts:14`
**Claim it contradicts:** Pricing 'Start free trial' / Settings 'Manage billing portal', 'Change plan', 'Cancel' imply working billing for signed-in users  

**Problem:** getAuthToken() calls insforge.auth.getSession(), a method absent from the SDK's Auth class, so it always throws→catch→null — making createCheckoutSession, createBillingPortalSession, changeSubscription, and cancelSubscription all return 'You must be signed in' even for authenticated users.

**Evidence:** Verified: src/lib/stripe.ts:12-19 calls insforge.auth.getSession() and reads result?.data?.session?.access_token, behind an `as any` cast at :7-8 that masks the type error. The SDK Auth class (node_modules/@insforge/sdk/dist/index.d.ts:298-427) exposes signUp/signInWithPassword/refreshSession/getCurrentUser/... but no getSession; getSession exists only on the private TokenManager and returns camelCase accessToken. Every billing call short-circuits at stripe.ts:104-105, 134-135, 160-161, 189-190. tests/stripe.test.ts covers only PRICE_IDS and webhook stubs, so 109/109 green tests never exercise this.

**Fix:** Export a shared getAccessToken() from src/lib/api.ts using the proven mechanism (insforge getHttpClient().getHeaders().Authorization, strip 'Bearer '), use it in stripe.ts, remove the `as any` cast so tsc catches future drift, and add a test asserting a token is attached when a session exists.

---

### C10. authGuard validates tokens against Supabase-style /auth/v1/user, not the InsForge SDK contract
**🆕 NEW** · owner: `opus` · effort: M · category: auth  
**File:** `server.cjs:253`
**Claim it contradicts:** 'resolve launch-readiness P0 blockers' commit implies working authenticated APIs  

**Problem:** authGuard verifies bearer tokens via GET ${INSFORGE_BASE_URL}/auth/v1/user — a Supabase GoTrue path — while the @insforge/sdk's current-user endpoint is /api/auth/sessions/current; if InsForge serves no Supabase compat layer, every valid token 401s and all authenticated endpoints (emissions, billing, trial-status, ingest, reports) break in production.

**Evidence:** Verified: server.cjs:253 fetches INSFORGE_BASE_URL + '/auth/v1/user' and 401s on !userRes.ok (:252-258). The SDK never references /auth/v1/* (grep of node_modules/@insforge/sdk/dist: zero hits); its session endpoint is '/api/auth/sessions/current' (dist/index.mjs:630,992). No test exercises this path — apiAuthGuard falls back to a dev-user when INSFORGE_BASE_URL is unset (server.cjs:271-288) so CI never hits it. Caveat: the live InsForge deployment's route table cannot be confirmed from the repo; if it exposes a Supabase-compat layer this works, but nothing in the repo supports that assumption.

**Fix:** Change authGuard to GET ${INSFORGE_BASE_URL}/api/auth/sessions/current with the Bearer token and map the returned user (id/email) onto req.user; add an integration test mocking that exact path; verify once against the real InsForge instance (curl both paths with a fresh token) before launch.

---

### C11. Stop selling ComingSoon-stub features on paid plans via live Stripe checkout
**🆕 NEW** · owner: `opus` · effort: L · category: claims  
**File:** `src/data/mockData.ts:238`
**Claim it contradicts:** Growth ($399/mo): 'AI Carbon Assistant', 'Supplier request hub', 'QuickBooks & Xero integrations', 'Audit trail & report exports'; Pro ($999/mo): 'Team permissions & roles', 'API access', 'Multi-entity'; landing FeatureCards and index.html featureList advertise the same  

**Problem:** Pricing runs a real Stripe checkout selling Growth/Pro features that are ComingSoon placeholders or have zero backing code — AI Assistant, Ledger, Reports, and Suppliers pages are all stubs, QuickBooks/Xero Connect buttons are dead, UPS/FedEx are hardcoded 'connected', and no roles/API-key/multi-entity code exists (schema is strictly single-user).

**Evidence:** mockData.ts:238-246 (Growth) and :256-264 (Pro) rendered as purchasable by Pricing.tsx:108-121 with working checkout (Pricing.tsx:125 → /api/checkout, server.cjs:594-627). But AIAssistant.tsx:4, Suppliers.tsx:4, Ledger.tsx:4, Reports.tsx:4 all render <ComingSoon> ('not connected to production data yet', ComingSoon.tsx:16); QuickBooks/Xero buttons have no onClick (DataIntake.tsx:332,349); UPS/FedEx hardcoded 'connected' (DataIntake.tsx:4-9) and FEATURE_COMPARISON claims the connectors (mockData.ts:312-313); schema is single-user with UNIQUE(user_id) and owner-only RLS (migrations/20260611141026_initial-schema.sql:12,87-156). LandingPage.tsx:252-270 and index.html:113-120 featureList repeat the claims.

**Fix:** Rewrite plan feature lists and landing FeatureCards/index.html featureList to only what ships (CSV intake, calculator, dashboard, PDF summary, email support); move unbuilt items to a labeled Roadmap section; remove the fabricated UPS/FedEx 'connected' status and the connectors/QuickBooks rows from FEATURE_COMPARISON; or block checkout for tiers whose defining features are stubs.

---

### C12. Subscription change/cancel 501 stubs — verified fixed as real Stripe mutations
**✅ FIXED** · C12 · owner: `fable` · effort: S · category: billing  
**File:** `server.cjs:511`

**Problem:** PATCH and DELETE /api/subscription are now real Stripe implementations (plan swap with proration, cancel-at-period-end) that persist state via syncSubscriptionRecord, with client wrappers wired. (Remaining user-visible gaps — mock Settings display, mock billing-cycle argument, copy contradiction — are tracked as separate OPEN findings.)

**Evidence:** server.cjs:511-535 PATCH (resolvePlanPriceId, findActiveSubscription, stripe.subscriptions.update, sync at :528); :537-552 DELETE (cancel_at_period_end + sync); client wrappers stripe.ts:155-207.

**Fix:** 

---

### C13. Webhook subscription persistence — verified fixed
**✅ FIXED** · C2 · owner: `fable` · effort: S · category: billing  
**File:** `server.cjs:663`

**Problem:** Stripe webhook events now persist subscription state to the companies table instead of only console.log; failures return 500 so Stripe retries.

**Evidence:** server.cjs:663-697: checkout.session.completed retrieves the subscription and calls syncSubscriptionRecord; subscription created/updated/deleted sync too; syncSubscriptionRecord (:417-458) maps customer→user and UPDATEs companies subscription columns (added by migrations/20260703000000_add-billing-and-consent.sql:5-14). Note: correct operation still depends on the missing `users` table (see the CRITICAL users-table finding) and is subject to the LOW event-ordering finding.

**Fix:** 

---

### C14. Mobile navigation — verified fixed on both marketing header and app shell
**✅ FIXED** · C7 · owner: `fable` · effort: S · category: ux  
**File:** `src/App.tsx:196`

**Problem:** The marketing Header has a hamburger with an expanding mobile menu (nav + CTAs, aria-expanded, closes on navigate) and the app shell has a hamburger-triggered drawer with backdrop and close-on-route-change.

**Evidence:** Header.tsx:143-153 hamburger with aria-expanded, :175-203 mobile panel; App.tsx:196-229 drawer (fixed inset-0 z-40 md:hidden) with SidebarContent/onNavigate; :91-95 render-time close on location change.

**Fix:** 

---

### C15. Fake AI Assistant — verified fixed (gated behind honest ComingSoon)
**✅ FIXED** · C8 · owner: `fable` · effort: S · category: claims  
**File:** `src/pages/AIAssistant.tsx:4`

**Problem:** The fake canned-response assistant and its false 'Powered by GHG Protocol methodology' claim are gone; the page renders <ComingSoon featureName="AI Carbon Assistant"/> which states 'This feature is not connected to production data yet.' (The feature is still SOLD on Growth — tracked in the CRITICAL ComingSoon-features finding.)

**Evidence:** AIAssistant.tsx:1-5 returns <ComingSoon/>; ComingSoon.tsx:14-17 honest copy; the mock CHAT_MESSAGES transcript remains in mockData.ts:154-183 but is unimported.

**Fix:** 

---

### C16. Mock Reports, Ledger, and Suppliers pages — verified fixed (gated behind ComingSoon)
**✅ FIXED** · C9 · owner: `fable` · effort: S · category: claims  
**File:** `src/pages/Reports.tsx:4`

**Problem:** Prior C9/C10/C11: all three 100%-mock pages (fake REPORTS data with dead export buttons, fake LEDGER_ENTRIES with a static '87% defensible' badge, mock SUPPLIERS with no-op questionnaire buttons) were replaced with one-line ComingSoon gates; the mock datasets remain in mockData.ts but are unreferenced. (Marketing/pricing still sells these features — tracked separately.)

**Evidence:** Reports.tsx:4, Ledger.tsx:4, Suppliers.tsx:4 each render <ComingSoon/>; grep confirms REPORTS (mockData.ts:134-141), LEDGER_ENTRIES (:123-132), SUPPLIERS (:143-152) have no importers; nav still links all three (App.tsx:39-42) but lands on the honest gate.

**Fix:** 

---

## 🟠 HIGH (27)

### H1. Replace developer312/NIGHT LITE identity with EcoAuditor branding across site, metadata, and chatbot
**🔴 OPEN** · H10 · owner: `fable` · effort: M · category: claims  
**File:** `src/components/Footer.tsx:57`
**Claim it contradicts:** Product markets itself as Eco-Auditor/ecoauditor.io, an audit-grade compliance platform  

**Problem:** Off-brand personal/agency identity (hello@developer312.com, @developer312, NIGHT LITE USA LLC, a personal phone, and the founder's personal name) is served to customers, crawlers, and security researchers across the Footer, Contact page, landing demo CTA, index.html JSON-LD/meta, chatbot responses, security.txt, humans.txt, and llms.txt — no ecoauditor.io address exists anywhere in src.

**Evidence:** Footer.tsx:57,67 mailto:hello@developer312.com; :74-75 '© Developer312 / subsidiary of NIGHT LITE USA LLC'; :81-84 suite interlinks. ContactUs.tsx:47,67-68,152. LandingPage.tsx:91 Book a Demo mailto. index.html:11 (author), :35 (twitter:site @developer312), :72-78 (JSON-LD parentOrganization NIGHT LITE USA LLC, +1-510-401-1225). server.cjs:813 chatbot hands out the same email/phone. public/.well-known/security.txt:1-2, public/humans.txt:3-9, public/llms.txt:5-7 (personal name + phone).

**Fix:** Provision hello@ecoauditor.io (or support@) and substitute across Footer.tsx, ContactUs.tsx, LandingPage.tsx:91, index.html JSON-LD/meta, server.cjs:813, security.txt, humans.txt, llms.txt; keep the legal-entity disclosure only where legally required (Terms/Privacy/footer fine print).

---

### H2. Replace fabricated Settings billing display with real /api/billing state
**🔴 OPEN** · H3 · owner: `opus` · effort: M · category: billing  
**File:** `src/pages/Settings.tsx:44`
**Claim it contradicts:** Settings > Billing presents 'Current Plan: Growth, active, renews 2027-01-15 $3,990', paid invoices, Visa ••••4242, and '3/5 facilities' usage as the user's account state  

**Problem:** Every user — including free/expired-trial users — sees hardcoded mock subscription, invoices, payment method, and usage, while the mutation buttons hit real Stripe APIs; after a real cancel succeeds, the reload re-renders the mock 'active' state so customers get no confirmation. The real GET /api/billing endpoint has zero frontend consumers.

**Evidence:** Settings.tsx:3 imports BILLING_SUBSCRIPTION, INVOICES, PAYMENT_METHOD from mockData; :44-45 const sub = BILLING_SUBSCRIPTION (mockData.ts:276-300: growth/annual/active, Visa 4242, five paid invoices); rendered at :137-165, :218-260; usage '3 / 5 facilities' hardcoded (:155-163). handleCancel (:33-42) calls the real DELETE /api/subscription (server.cjs:537-552) then window.location.reload() back onto mock 'active'. GET /api/billing returns real synced state (server.cjs:214-229, loadBillingState :462-472) but grep of src/ for 'api/billing' returns zero matches. Fake northstarfoods.com team roster also shown (:113-116).

**Fix:** Fetch GET /api/billing (with bearer token via the shared auth helper) on mount and after mutations; drive plan/status/cycle/renewal/trialEndsAt/cancelAtPeriodEnd from the response; replace the invoice table and payment-method card with the working Stripe portal link (handlePortalSession, Settings.tsx:12-20) or a server invoices endpoint; delete BILLING_SUBSCRIPTION/INVOICES/PAYMENT_METHOD usage.

---

### H3. Add Header/Footer chrome to public /pricing and Footer to MethodologyPublic, SampleReport, and Security
**🔴 OPEN** · H8 · owner: `fable` · effort: S · category: ux  
**File:** `src/App.tsx:271`

**Problem:** The public /pricing route (sitemap priority 0.9, linked from header nav) renders with no site header, nav, logo, or footer — visitors have no way to navigate except plan buttons — and the three marketing pages that do render a Header end without any Footer (no legal links or contact); UpgradePrompt also links in-app users to bare /pricing, ejecting them from the app shell.

**Evidence:** App.tsx:271 routes '/pricing' directly to <Pricing /> in the chrome-less public branch (:268-280); Pricing.tsx has no Header/Footer imports. MethodologyPublic.tsx:92, SampleReport.tsx:53, Security.tsx:33 render <Header variant="marketing"/> but grep for Footer in those three files returns zero matches — only LandingPage renders <Footer/> (:337); legal pages get one via the layout at App.tsx:177. UpgradePrompt.tsx:20 links to '/pricing' instead of '/app/pricing'.

**Fix:** Wrap the public marketing routes in a shared layout with Header + Footer (or render them per page); change UpgradePrompt.tsx:20 to '/app/pricing'.

---

### H4. Move lead capture off the ephemeral plaintext JSON file; stop promising 24-hour follow-up nobody sees; stop leaking lead PII in the PrismDeck URL
**🔴 OPEN** · L3 · owner: `opus` · effort: M · category: privacy  
**File:** `server.cjs:736`
**Claim it contradicts:** '🎉 Demo booked! Our team will reach out within 24 hours'; DPA Annex II promises backup/recovery procedures; PrismDeck host is absent from the DPA subprocessor list  

**Problem:** All sales leads (name, email, company, free-text message) persist only to plaintext .data/leads.json on the app container — wiped on every Railway redeploy, with no email/CRM notification — while the chatbot confirms demos as 'booked... within 24 hours' and hands prospects a hardcoded third-party Railway URL carrying their email and company name in the query string (an undisclosed processor, PII in URL logs/history).

**Evidence:** writeLead() at server.cjs:736-741 appends to LEADS_FILE = path.join(__dirname, '.data', 'leads.json') (:722) — the ONLY persistence for /api/leads (:1068) and both chatbot flows (:883-891, :924-930), with no pgPool branch (contrast consent-audit which writes Postgres at :784-790). Chatbot promises at :897 and :924-932. server.cjs:894 builds https://radiant-alignment-production-b430.up.railway.app/?product=ecoauditor&company=...&email=... — host absent from DPA Annex III (DataProcessingAddendum.tsx:246-251). No persistent volume for .data in Dockerfile/railway config.

**Fix:** Add a leads table migration and make writeLead() insert via pgPool (mirror the consent-audit pattern), plus an email/ops notification; soften the '24 hours' bot copy until follow-up is automated; replace the PrismDeck email/company query params with an opaque token behind an env-configured branded URL (or drop the link) and list any retained third party in the DPA.

---

### H5. Fix trend endpoint: only Jan-Sep buckets exist and months are aggregated across ALL years
**🔴 OPEN** · M10 · owner: `fable` · effort: S · category: pipeline  
**File:** `server.cjs:1194`
**Claim it contradicts:** Dashboard 'Emissions Trend' presented as the FY 2026 overview  

**Problem:** /api/emissions/trend hardcodes 9 month buckets (Oct-Dec entries match no bucket and silently vanish — breaks in production within 3 months of today) and loads entries with no year filter, bucketing by getMonth() only, so a company with 2025 and 2026 data has both years' January summed into one point; the period param is repurposed for granularity so a year can never be requested.

**Evidence:** server.cjs:1195 `const monthNames = ['Jan',...,'Sep'];` — 9 buckets (:1196-1208); quarterly slices only Q1-Q3 (:1210-1215). :1194 `loadEmissionEntries(companyId)` with no period argument (unlike summary at :1177), then :1197-1199 filters only date.getMonth() === index; the period query param means monthly/quarterly (:1191).

**Fix:** Extend monthNames to 12 months, add Q4 (slice(9,12)); accept a `year` param (default current year) passed into loadEmissionEntries' EXTRACT(YEAR...) filter, with a separate `granularity` param.

---

### H6. Data Intake is a mock facade that fakes compliance success: setTimeout 'approved' toasts, fake OCR, fake 'connected' integrations
**🔴 OPEN** · M3 · owner: `opus` · effort: L · category: claims  
**File:** `src/pages/DataIntake.tsx:41`
**Claim it contradicts:** 'Record approved and added to the emissions ledger.' success toast; 'Human review queue'; 'connected' UPS/FedEx badges; 'OCR extraction with confidence scores' (landing)  

**Problem:** Approve/Request-Review buttons await a 600ms setTimeout then show false success ('added to the emissions ledger' — a ledger that is itself a ComingSoon stub); the file list, OCR panel (always the same PG&E bill at '96% confidence'), facility cards, and '12 records pending' review queue are all hardcoded mocks; UPS/FedEx show fabricated 'connected' status and QuickBooks/Xero Connect buttons have no onClick; real CSV uploads never appear in the 'Uploaded Files' list.

**Evidence:** DataIntake.tsx:41-54 handleApprove: '// TODO: Replace with insforge.db.insert...' + setTimeout(600) + success toast; :56-69 handleRequestReview identical; :71-74 Edit Fields success-styled 'coming soon'. :2 imports UPLOADED_FILES, OCR_PREVIEW, FACILITIES from mockData; :224-262 mock file list (uploads only set csvResult, never refresh the list); :269-286 OCR_PREVIEW rendered unconditionally with hardcoded 96%/12-fields badges (:273-274); :4-9 INTEGRATIONS hardcodes UPS/FedEx 'connected'; :332,349 Connect buttons no onClick; :378 hardcoded '12 records pending'; :393-397 static review rows with no-op Review buttons (:405).

**Fix:** Gate the review workflow behind the ComingSoon pattern or wire it to real emission_entries writes; list real uploads/ingest results; remove or 'Example'-label the OCR panel; set integrations to 'Not connected' with disabled buttons until OAuth exists; derive the pending count from real data. Never emit success toasts from setTimeout placeholders in an audit-trail product.

---

### H7. Make the calculator factor lookup unit-aware — factors applied to whatever number is typed
**🔴 OPEN** · M9 · owner: `fable` · effort: M · category: pipeline  
**File:** `src/components/carbon-calculator/utils.ts:108`
**Claim it contradicts:** Form shows 'Estimated: N kg CO2e' as an EPA-factor calculation ('method: EPA emission factor')  

**Problem:** calculateEmissions(category, source, amount) never receives the selected unit; each factor assumes one fixed unit (Natural Gas per MMBtu, Gasoline per gallon) while the user can pick any of 8 units, so e.g. therms of natural gas are computed with the per-MMBtu factor (~10x overstatement) and the wrong result is persisted as the entry amount.

**Evidence:** utils.ts:108-114 has no unit parameter; UNITS at utils.ts:22 offers kWh/therms/gallons/miles/kg/tons/MMBtu/room-nights for every category; EmissionForm.tsx:29 captures unit state but :36 calls calculateEmissions(category, source, parsedAmount) without it; the calculatedKg is persisted (index.tsx:97).

**Fix:** Key factors by source+unit (mirror emissions-engine.cjs SCOPE1_FACTORS), pass the unit into calculateEmissions, restrict the unit dropdown to units valid for the selected source, and reject unsupported pairs instead of computing.

---

### H8. Remove fabricated Northstar Foods identity, CFO dollar metrics, and readiness/alerts/tasks from the live Dashboard
**🟠 PARTIAL** · H11 · owner: `opus` · effort: M · category: claims  
**File:** `src/pages/Dashboard.tsx:175`
**Claim it contradicts:** 'Consultant spend avoided $84,000', 'Contracts at risk: 2', '$340K exposure', readiness 72, 'overdue' compliance task — presented as the customer's own audit/financial position  

**Problem:** The app-shell breadcrumb was fixed (real company name, H11), but the Dashboard itself still shows every user 'Northstar Foods' / 'Food & Beverage / 3 Facilities', six fabricated CFO financial metrics, a fake readiness score, fake missing-data alerts with dead action buttons, fake compliance deadlines (one 'overdue'), and a fake setup checklist — interleaved with their real emissions totals so fabricated dollar figures read as computed.

**Evidence:** Fixed part: App.tsx:230-234 breadcrumb now renders user?.companyName || 'Your organization'. Remaining: Dashboard.tsx:2 imports READINESS_SCORE, MISSING_DATA_ALERTS, COMPLIANCE_TASKS, CFO_METRICS, ONBOARDING_CHECKLIST, COMPANY from mockData; :175 <h1>{COMPANY.name}</h1> ('Northstar Foods', mockData.ts:2); :179-181 hardcoded badges; :186-192 CFO_METRICS ('$84,000', '$340K', contractsAtRisk 2 — mockData.ts:84-92); :244-270 READINESS_SCORE; :276-287 alerts with onClick-less action buttons (:283); :294-308 COMPLIANCE_TASKS; :313-325 ONBOARDING_CHECKLIST. Real data is only the trend chart and scope totals (:47-70). App.tsx:113-118 already resolves the real companyName that Dashboard ignores.

**Fix:** Use the authenticated company name (and facility count from /api/companies/:id/facilities) in the header; remove or ComingSoon-gate the CFO metrics, readiness ring, alerts, tasks, and checklist until computed from real data — fabricated dollar-risk figures shown to paying customers are a legal/trust liability.

---

### H9. Fix plan change silently switching monthly customers to annual billing
**🆕 NEW** · owner: `fable` · effort: S · category: billing  
**File:** `src/pages/Settings.tsx:191`

**Problem:** The 'Switch Plan' buttons pass the MOCK subscription's billing cycle (hardcoded 'annual') to the real PATCH /api/subscription, so a monthly customer who clicks Upgrade/Downgrade is moved to the annual Stripe price with immediate prorations — e.g. Growth-monthly ($399/mo) clicking Upgrade is prorated onto Pro annual ($9,990) without ever choosing annual.

**Evidence:** Settings.tsx:191 onClick={() => handleChangePlan(plan.id, sub.billing)} where sub = BILLING_SUBSCRIPTION (:44) and .billing is hardcoded 'annual' (mockData.ts:278). handleChangePlan (:22-31) → changeSubscription → PATCH /api/subscription (stripe.ts:155-182); server resolves the annual price via resolvePlanPriceId(env, planId, 'annual') and applies it immediately with proration_behavior:'create_prorations' (server.cjs:514,523-527).

**Fix:** Fetch the real billingCycle from GET /api/billing (server returns it, server-billing.cjs:101) and pass that; add an explicit monthly/annual selector in the Switch Plan card so a cycle change is never implicit.

---

### H10. No working report/PDF path end-to-end: UI invokes a nonexistent function, the real server route has no caller, and PDFs live in a process-memory Map
**🆕 NEW** · owner: `opus` · effort: M · category: pipeline  
**File:** `src/components/carbon-calculator/ReportGenerator.tsx:50`
**Claim it contradicts:** 'Generate PDF' button; 'audit-ready reports' marketing; Starter sells '1 reporting template'  

**Problem:** The only report UI inserts a reports row hardcoded status 'final'/completeness 100 before any artifact exists, then invokes InsForge function 'generate-pdf' which does not exist in the repo (UI admits 'PDF generation function not yet deployed'); the server's working /api/companies/:id/reports/generate + download pipeline has no frontend caller (Reports.tsx is ComingSoon), and generated PDFs + ingest jobs are stored in unbounded module-level Maps lost on any restart/redeploy — no customer can ever obtain a report PDF.

**Evidence:** ReportGenerator.tsx:36-44 inserts { status: 'final', completeness: 100, signoff: 'pending' } unconditionally; :50-58 invoke('generate-pdf') — grep finds 'generate-pdf' only there and in CALCULATOR_SPEC.md (spec, not code); success branch surfaces no download URL. Grep of src/ shows no caller of /api/companies/:id/reports/generate or /api/reports/:id/download; Reports.tsx:4 is <ComingSoon>. Server side: server.cjs:75-76 `const ingestJobs = new Map(); const generatedReports = new Map();`, PDF Buffer stored at :1399, download 404s on Map miss (:1407-1408), ingestJobs.set at :1316 with no pruning; the reports table (initial-schema.sql:43-53) is never used by the server route.

**Fix:** Wire ReportGenerator to POST /api/companies/:id/reports/generate with auth headers and open the returned download_url; delete the dead invoke path; insert report rows as 'draft' with computed completeness and finalize only on successful generation; persist report metadata + PDF (bytea/object storage) to public.reports and add TTL eviction for ingestJobs.

---

### H11. Remove fictional AI/OCR document-extraction claims — only CSV text parsing exists
**🆕 NEW** · owner: `fable` · effort: M · category: claims  
**File:** `src/pages/LandingPage.tsx:112`
**Claim it contradicts:** 'AI extracts & calculates — Our engine parses every document... assigns a confidence score' / 'OCR and AI parse your documents' / 'Drop utility bills, fuel invoices, freight docs'  

**Problem:** The core product story — AI/OCR extraction of bills, invoices, and freight docs with per-field confidence — has zero backing code: no OCR/PDF/vision dependency exists, the only ingest path is CSV text parsing, the 'OCR Extraction Preview' is a hardcoded mock, PDF/image files are accepted by the picker then rejected, and 'confidence scores' are static per-category constants.

**Evidence:** LandingPage.tsx:106,110-114,218,248 and FAQ :15,25 make the claims; package.json has no OCR/PDF/vision dependency; the only ingest is CSV parsing (server.cjs:1233-1241, emissions-engine.cjs:179-207); DataIntake OCR panel renders the hardcoded OCR_PREVIEW mock (DataIntake.tsx:269-286, mockData.ts:105-121); non-CSV files are skipped despite accept='.csv,.xlsx,.pdf,.png,.jpg' (DataIntake.tsx:84-87,118); confidence is a static constant per category (emissions-engine.cjs:49-62).

**Fix:** Change marketing copy to 'CSV import' until extraction ships; remove or 'Example'-label the mock OCR panel; restrict the file input to .csv; delete the fabricated 96%-confidence badges.

---

### H12. Correct methodology pages: claimed factor libraries, market-based Scope 2, and 15 Scope 3 categories are not in the engine
**🆕 NEW** · owner: `opus` · effort: L · category: claims  
**File:** `src/pages/MethodologyPublic.tsx:237`
**Claim it contradicts:** 'GLEC Framework v3, EXIOBASE 3.8, IPCC AR6 GWP-100, EPA WARM... 15 categories supported... market-based dual reporting... every factor citation-tracked... custom factors on Pro... change logs published'  

**Problem:** The public methodology page (and the in-app page showing these libraries as 'active') claims factor databases, refrigerant/GWP handling, market-based Scope 2, 15 Scope 3 categories, custom factor overrides, and citation tracking — none of which exist in the engine, which is 12 stationary fuels, 4 mobile factors, 9 eGRID subregions, and 9 generic spend-based Scope 3 constants.

**Evidence:** MethodologyPublic.tsx:237-243 (library cards), :49-50 ('15 categories supported', EXIOBASE), :40 (market-based dual reporting), :234 ('citation-tracked'), :270-271 (annual updates, custom factors on Pro); Methodology.tsx:87-92 lists GLEC/EXIOBASE/IPCC/WARM as 'active' with a no-op market-based 'Enable' button (:58). The entire engine is emissions-engine.cjs:3-62 — no refrigerant/GWP data, no GLEC/EXIOBASE/WARM factors, no market-based path, no citations, no custom-factor mechanism; the methodology string is the hardcoded label 'EPA GHG Protocol + IPCC AR6' (emissions-engine.cjs:158).

**Fix:** Rewrite both methodology pages to the actual factor set (EPA-derived stationary/mobile, 9 eGRID subregions location-based only, spend-based Scope 3 for 9 categories); mark GLEC/EXIOBASE/IPCC/WARM, market-based reporting, and custom factors as roadmap; remove 'citation-tracked' and 'change logs' until implemented.

---

### H13. Stop silently defaulting unknown grid regions to the California factor; remove T&D uplift from Scope 2; reject non-kWh units
**🆕 NEW** · owner: `opus` · effort: M · category: claims  
**File:** `emissions-engine.cjs:102`
**Claim it contradicts:** 'GHG Protocol aligned' / 'Location-based: kWh × eGRID subregion emission factor' / 97% confidence for purchased electricity  

**Problem:** Any Scope 2 source outside the 9 hardcoded eGRID codes — including every value the frontend offers ('US Average', 'California', 'Texas', 'New York', 'Renewable') — silently gets California's low-carbon CAMX factor (~57% understatement for e.g. a Michigan company), any unit other than kWh is silently treated as MWh, and a 4.75% transmission-loss uplift is baked into Scope 2 (the GHG Protocol assigns T&D losses to Scope 3 cat 3) — all with confidence still reported as 97.

**Evidence:** emissions-engine.cjs:102 `EGRID_FACTORS[sourceRaw] ?? EGRID_FACTORS.CAMX` (RFCM 0.487 vs CAMX 0.207); :103 `unit === 'kwh' ? 0.001 : 1`; :105 `factor * (1 + TRANSMISSION_LOSS_RATE)` with TRANSMISSION_LOSS_RATE 0.0475 (:1); only 9 of 27 subregions exist (:25-35) while MethodologyPublic.tsx:239 claims 'Subregion-level grid emission factors'. Frontend Scope 2 sources (utils.ts:99) match no EGRID key. CONFIDENCE_BY_CATEGORY.purchased_electricity = 97 (:52) applied regardless (:132).

**Fix:** Reject or flag-for-review unknown grid regions (mirror the Scope 1 unsupported-source error at :96) and units outside an explicit {kwh:0.001, mwh:1} map; drop the transmission-loss multiplier from Scope 2 (report T&D separately under Scope 3 cat 3 if desired); add the remaining eGRID subregions.

---

### H14. Remove 'immutable audit trail' marketing — no audit schema exists and entries are mutable/deletable
**🆕 NEW** · owner: `opus` · effort: L · category: claims  
**File:** `src/pages/LandingPage.tsx:258`
**Claim it contradicts:** 'Emissions Ledger — Immutable audit trail. Every entry shows source, emission factor, reviewer, timestamp, and version history'  

**Problem:** Marketing sells an immutable, reviewer-tracked, versioned ledger, but the Ledger page is a ComingSoon stub, the schema has no reviewer/version/status/document columns, RLS explicitly permits UPDATE and DELETE on emission entries, and the calculator UI hard-deletes entries with a single un-confirmed click.

**Evidence:** LandingPage.tsx:256-259 (feature card) and :201-203 ('Every number traces back to a source document, emission factor, reviewer, and timestamp'); Ledger.tsx:4 is <ComingSoon>; migrations/20260611141026_initial-schema.sql:25-38 emission_entries has no reviewer/version/status/document columns and :131-138 owner_update/owner_delete policies allow mutation; no history/audit table exists in any migration; EmissionList.tsx:67-75 one-click hard delete with no confirm (index.tsx:110-118).

**Fix:** Soften copy to 'timestamped emissions ledger (audit trail coming)' or implement it: reviewer_id/status/version columns plus an append-only revisions table, revoke UPDATE/DELETE in favor of superseding revisions, and add a delete confirmation before ever using the word 'immutable'.

---

### H15. Trim sample-report promises: assertion letters, SB 253/CBAM packages, and XBRL/XLSX/JSON exports do not exist
**🆕 NEW** · owner: `fable` · effort: M · category: claims  
**File:** `src/pages/SampleReport.tsx:162`
**Claim it contradicts:** 'Every report package includes: GHG Protocol assertion letter, California SB 253 disclosure pack, CBAM reporting templates...' / 'Export in PDF, CSV, XLSX, JSON, XBRL'  

**Problem:** The sample-report page promises assertion letters, SB 253/CBAM packages, base-year memos, and five export formats including XBRL, while the only real output is a hand-rolled 6-line plain-text PDF held in an in-memory Map, with no CSV/XLSX/JSON/XBRL export code and no CBAM logic anywhere.

**Evidence:** SampleReport.tsx:160-162 (deliverables list) and :186 (format chips incl. 'XBRL (compliance)'); the entire report backend is server.cjs:1391-1439 (createSimplePdf of 6 text lines into the generatedReports Map at :76, download :1406-1414); compliance engine knows only SB 253 and CSRD flags (emissions-engine.cjs:233-257); grep confirms no CBAM/XBRL implementation; Reports.tsx:4 is ComingSoon.

**Fix:** Trim the deliverables list and format chips to PDF summary + CSV of entries (the CSV export is trivial from emission_entries — implement it); label the rest 'planned'; persist generated reports to the reports table instead of memory.

---

### H16. Correct the Security page: RBAC, SSO, API keys, retention controls, AWS hosting, and backup claims are not real
**🆕 NEW** · owner: `opus` · effort: M · category: security  
**File:** `src/pages/Security.tsx:78`
**Claim it contradicts:** 'RBAC per workspace', 'SSO-ready: SAML 2.0 and OIDC on Pro', 'API keys scoped to permissions', 'Data retention policies configurable per workspace', 'source deleted on schedule (default: 90 days)', 'Cloud infrastructure on AWS', 'SOC 2 Type II audit in progress'  

**Problem:** The trust page enumerates enterprise controls with no implementation: the data model is strictly one-user-one-company with no roles, no SAML/API-key/retention code exists anywhere, document storage does not exist to be deleted, leads/consent fall back to local JSON files on the app container (contradicting the backup/DR posture), and deploy config targets Railway, not AWS.

**Evidence:** Security.tsx:78-81 (RBAC/SSO/API keys/session claims), :89-91 (retention + scheduled deletion), :68 ('AWS and InsForge'), :98 (SOC 2 Type II), :108-111 (backups/PITR/quarterly DR), :126,129 (90-day auto-delete, deletion-on-cancellation). Reality: UNIQUE(user_id) single-owner tenancy with owner-only RLS (initial-schema.sql:12,87-156); no SAML/API-key/retention code in src/ or server.cjs (auth is InsForge bearer only, server.cjs:241-269); no file storage (only CSV text bodies); leads written to local JSON (server.cjs:722-757); deployment is Railway (railway.json, railway.toml, Procfile, nixpacks.toml). The DPA itself says 'Developer312 does not overclaim certifications or controls not currently in place' (DataProcessingAddendum.tsx:231).

**Fix:** Rewrite to verifiable facts (TLS via platform, Postgres RLS tenant isolation, bearer-token auth, signature-verified Stripe webhooks, rate limiting, security headers per server-security.cjs); move RBAC/SSO/API keys/retention/SOC 2 to a dated roadmap; change 'AWS' to the actual host.

---

### H17. Fix sales chatbot's fabricated capabilities and AB 1305 legal misstatement
**🆕 NEW** · owner: `fable` · effort: S · category: claims  
**File:** `server.cjs:817`
**Claim it contradicts:** 'Automatic data collection from your systems', 'AI-powered insights', SEC climate disclosure support, 'Pre-built connectors for major ERPs', 'Webhook support', AB 1305 compliance  

**Problem:** The public chatbot asserts capabilities with no backing code (automatic data collection, ERP connectors, direct API, webhooks, AI insights, SEC-rule scenario analysis) and misstates California law — it calls AB 1305 the 'Climate Corporate Data Accountability Act' (that is SB 253; AB 1305 is the Voluntary Carbon Market Disclosures Act) — giving prospects wrong compliance guidance from a compliance product.

**Evidence:** server.cjs:817 ('Automatic data collection... AI-powered insights'), :829 (SEC 'materiality assessment guidance... scenario analysis support'), :832-833 ("Climate Corporate Data Accountability Act (AB 1305)" + 'Automated emissions reporting... Third-party verification support'), :841 ('Direct API... Pre-built connectors for major ERPs... Webhook support'); no ERP/webhook/API-key/scenario code exists anywhere in the repo; the rest of the site correctly references SB 253 (LandingPage.tsx:13).

**Fix:** Rewrite ECOAUDITOR_KB entries to actual capabilities (CSV import, GHG-scope calculator, dashboard, PDF summary, Stripe billing); correct AB 1305→SB 253; drop the SEC/ERP/webhook entries; derive the pricing entry from the shared pricing constant.

---

### H18. Add a password reset / forgot-password flow
**🆕 NEW** · owner: `fable` · effort: M · category: auth  
**File:** `src/pages/Login.tsx:102`
**Claim it contradicts:** Signup: 'Start your free trial... Set up in under 10 minutes' implies a normal self-service account lifecycle  

**Problem:** Login offers only email+password or OAuth with no 'Forgot password?' link, and no code path anywhere invokes the SDK's password-reset APIs — customers who forget their password are permanently locked out with no self-service recovery.

**Evidence:** Login.tsx:101-128 renders the password field with no reset link; grep for forgot|reset.?password|sendResetPasswordEmail across src/ returns zero matches; App.tsx:268-279 has no reset route. The SDK fully supports it: sendResetPasswordEmail, exchangeResetPasswordToken, resetPassword (node_modules/@insforge/sdk/dist/index.d.ts:406-423).

**Fix:** Add /forgot-password (calls insforge.auth.sendResetPasswordEmail({email, redirectTo})) and /reset-password (reads token from URL, calls resetPassword) routes, and a 'Forgot password?' link on Login.tsx.

---

### H19. Store CSV row dates — all imported history is attributed to the import timestamp
**🆕 NEW** · owner: `opus` · effort: M · category: pipeline  
**File:** `server.cjs:1291`
**Claim it contradicts:** CSV template documents a `date` column implying period-accurate accounting  

**Problem:** Ingested entries get created_at = now() and the parsed per-row date is kept only as an inert field; both the year filter and the monthly trend bucket on created_at, so a CSV of 12 months of 2025 utility bills all lands in July 2026, corrupting period totals and the trend chart.

**Evidence:** server.cjs:1289-1291 `date: row.date || null, created_at: new Date().toISOString()`; emission_entries has no activity-date column (initial-schema.sql:25-38); period filtering uses EXTRACT(YEAR FROM created_at) (server.cjs:1080) and trend buckets on entry.created_at month (:1198-1199); parseEmissionCsv explicitly supports a date column (emissions-engine.cjs:204).

**Fix:** Add an occurred_at DATE column (migration), populate it from the validated CSV date falling back to import time, and switch period filtering and trend bucketing to occurred_at.

---

### H20. Persist facility create/detail to the DB — facility routes operate on in-memory sample arrays
**🆕 NEW** · owner: `opus` · effort: M · category: pipeline  
**File:** `server.cjs:1354`
**Claim it contradicts:** Onboarding creates facilities; CSV template documents facility_name mapping  

**Problem:** POST /api/companies/:id/facilities pushes to the in-memory sampleFacilities array (lost on restart, invisible to the DB-backed GET list), GET /api/facilities/:id/emissions looks up only sampleFacilities (404 for every real DB facility), and CSV facility_name matching scans only sampleFacilities so real users' facility names never resolve.

**Evidence:** Create: server.cjs:1353-1355 sampleFacilities.push(facility) with no pgPool INSERT, while the GET list reads Postgres via loadFacilities (server.cjs:1103-1125) — a created facility disappears on next list. Detail: :1359 sampleFacilities.find(...) → 404 for DB facilities. CSV: :1244 filters sampleFacilities, so every real facility_name yields the 'not found — row stored without facility association' warning (:1263).

**Fix:** INSERT created facilities into public.facilities via pgPool and return the DB id; resolve facility detail and CSV facility_name against loadFacilities(companyId); keep the sample fallback only when allowSampleData().

---

### H21. Add per-row fault isolation — one unsupported entry 500s summary, trend, and reports for the whole company
**🆕 NEW** · owner: `fable` · effort: M · category: pipeline  
**File:** `emissions-engine.cjs:137`

**Problem:** summarizeEntries maps calculateEntry over every row with no per-row error handling, so a single row with an unknown source/unit (e.g. any calculator entry today) makes /api/emissions/summary, /api/emissions/trend, /api/calculate, and report generation throw for the entire company until the row is deleted.

**Evidence:** emissions-engine.cjs:136-137 `const calculated = entries.map(calculateEntry);` — calculateEntry throws (:91,96,111,118). Callers catch and 500: summary (server.cjs:1182-1185), trend (:1227-1230), report generate (:1401-1403). Contrast the CSV ingest route which deliberately isolates per-row errors (server.cjs:1269-1273) — the read path has none.

**Fix:** Wrap calculateEntry per row in summarizeEntries, collect failed rows into an excluded_entries array on the summary, aggregate only valid rows, and surface excluded counts to the dashboard instead of failing the endpoint.

---

### H22. Provide an in-product way to withdraw or change cookie consent
**🆕 NEW** · owner: `fable` · effort: S · category: privacy  
**File:** `src/components/CookieConsentBanner.tsx:8`
**Claim it contradicts:** 'GDPR compliant' / 'CCPA compliant' (Security.tsx:99-100); PrivacyPolicy.tsx:222 points users to browser settings instead  

**Problem:** Once a visitor makes any consent choice the banner never reappears and nothing in the UI calls resetConsent or reopens the preferences modal — no 'Cookie settings' link exists anywhere — so consent withdrawal is impossible in-product (GDPR Art. 7(3) requires withdrawal as easy as granting); GPC/DNT visitors are auto-marked hasConsented and permanently locked out of adjusting categories.

**Evidence:** CookieConsentBanner.tsx:8 `if (consentState.hasConsented) return null;` is the only entry to CookiePreferencesModal. resetConsent defined at consent-context.tsx:183-187 with zero call sites outside the provider (grep). Footer.tsx has no cookie-settings link (grep for consent|Cookie: nothing). GPC/DNT auto-set hasConsented=true (consent-context.tsx:87-91,132-143). Two agents independently corroborated.

**Fix:** Add a persistent 'Cookie settings' link in the Footer Trust column (and /privacy page) that opens CookiePreferencesModal directly (export it and lift showPreferences state, or call resetConsent to re-show the banner); ensure it works for GPC/DNT-auto-set visitors.

---

### H23. Remove aria-modal from the non-modal cookie banner — it marks the whole page inert for screen readers
**🆕 NEW** · owner: `fable` · effort: S · category: a11y  
**File:** `src/components/CookieConsentBanner.tsx:14`

**Problem:** The cookie banner is role="dialog" aria-modal="true" but is not modal (no focus trap, page fully interactive), which tells assistive technology the entire rest of the page is inert — effectively hiding all page content from screen-reader users on every page until they consent.

**Evidence:** CookieConsentBanner.tsx:12-16 `<div role="dialog" aria-modal="true" aria-label="Cookie consent preferences" className="fixed bottom-0 ...">`; rendered globally from App.tsx:71 with no focus management while the underlying page stays operable.

**Fix:** Change the banner to role="region" with the same aria-label and drop aria-modal; reserve role=dialog/aria-modal for CookiePreferencesModal once it gets real focus trapping.

---

### H24. Hardcoded Northstar breadcrumb and fake notification bell — verified fixed in the app shell
**✅ FIXED** · H11 · owner: `fable` · effort: S · category: ux  
**File:** `src/App.tsx:231`

**Problem:** The app-shell breadcrumb now shows the authenticated user's company name (fallback 'Your organization') with the current fiscal year, and the fake '1 unread alert' bell is gone. (The Dashboard page itself still renders Northstar mock content — tracked as the HIGH PARTIAL Dashboard finding.)

**Evidence:** App.tsx:230-234 {user?.companyName || 'Your organization'} / FY {year}; companyName resolved at :113-118; header actions :235-244 contain only the theme toggle.

**Fix:** 

---

### H25. Consent storage invalidation on policy version bump — verified fixed
**✅ FIXED** · H12 · owner: `fable` · effort: S · category: claims  
**File:** `src/lib/consent-context.tsx:60`

**Problem:** readConsentFromStorage now compares stored policyVersion against POLICY_VERSION and discards stale consent, so a policy bump re-prompts users.

**Evidence:** consent-context.tsx:59-64: mismatched versions clear localStorage and return the default (hasConsented:false) state, re-triggering the banner.

**Fix:** 

---

### H26. Root error boundary — verified fixed
**✅ FIXED** · H5 · owner: `fable` · effort: S · category: ux  
**File:** `src/components/ErrorBoundary.tsx:12`

**Problem:** A class-based ErrorBoundary with a 'Something went wrong' fallback, DEV-only stack trace, and reload button now wraps the entire app, so render exceptions no longer white-screen.

**Evidence:** ErrorBoundary.tsx:12-57 getDerivedStateFromError/componentDidCatch, DEV-gated stack (:44-49), reload (:50-52); App.tsx:31 import, :69-74 wraps <AppContent/>, <CookieConsentBanner/>, <TrackPageViews/>.

**Fix:** 

---

### H27. 404 handling — verified fixed for public and app routes
**✅ FIXED** · H7 · owner: `fable` · effort: S · category: ux  
**File:** `src/App.tsx:259`

**Problem:** A dedicated NotFound page renders for both unknown public routes and unknown /app routes instead of the old silent redirect/empty shell. (Residual edge: the isAppPage prefix bug routes /apple-style URLs to the auth gate first — tracked as a separate LOW.)

**Evidence:** NotFound.tsx:9-26; App.tsx:27 import, :259 app-shell catch-all route, :278 public catch-all (old redirect-to-/ gone).

**Fix:** 

---

## 🟡 MEDIUM (41)

### M1. Give the contact form a fallback path when InsForge is unconfigured or fails
**🔴 OPEN** · H9 · owner: `fable` · effort: M · category: ux  
**File:** `src/pages/ContactUs.tsx:16`
**Claim it contradicts:** 'Send us a message ... We typically respond within 1–2 business days'  

**Problem:** The contact form submits directly to the InsForge contact_submissions table with the anon client and surfaces 'backend not configured' to end users when client env/RLS is not set up; no mailto fallback exists on the submit path (direct email/phone cards above the form are the only mitigation).

**Evidence:** ContactUs.tsx:15-19 setSubmitError('Form submission is not available — backend not configured.') when isInsForgeConfigured is false (insforge.ts:24, build-time VITE_ vars); :22 insforge.database.from('contact_submissions').insert(...) — public-insert RLS on that table is unverifiable from the repo; contact cards at :47,57.

**Fix:** Route submission through a server-side /api/contact endpoint (verifying RLS), or render a mailto: CTA in the unconfigured/error branch instead of a dead form.

---

### M2. Unify client and server emission-factor vocabularies into one shared source
**🔴 OPEN** · M1 · owner: `opus` · effort: L · category: pipeline  
**File:** `src/components/carbon-calculator/utils.ts:27`
**Claim it contradicts:** Single 'EPA GHG Protocol' methodology claimed across the product  

**Problem:** Client and server factor tables disagree in units (kg vs tonnes), magnitude, and keys (display names like 'Fugitive Emissions'/'Refrigerant R-410A' vs snake_case source+unit like fuel_oil_2/CAMX/transport_inbound), so calculator previews cannot match server numbers and the two halves of the product cannot exchange data; several client categories have zero engine mapping.

**Evidence:** utils.ts:27-92 EMISSION_FACTORS (kg-basis, 11 display-name categories) vs emissions-engine.cjs:3-47 (tonnes-basis, source+unit keys, eGRID regions, spend-based Scope 3). Client 'Fugitive Emissions'/'Refrigerant R-410A' → factorForEntry throws (engine:94-97); engine's 'transport_inbound' has no client equivalent.

**Fix:** Extract one factor table (source+unit keyed) into a shared module consumed by both engine and client (or expose the engine's factors via an API for previews), and validate CSV/calculator inputs against that single vocabulary. Coordinate with the C3 pipeline fix.

---

### M3. Defer/lazy-load the landing videos and add captions/reduced-motion handling
**🔴 OPEN** · M11 · owner: `fable` · effort: S · category: ux  
**File:** `src/pages/LandingPage.tsx:64`

**Problem:** Two videos autoplay the same /api/video MP4 on the landing page (an 8%-opacity decorative hero background plus the showcase player), doubling bandwidth with no preload=none or poster; the showcase video has no captions track and neither respects prefers-reduced-motion.

**Evidence:** LandingPage.tsx:64-73 hero background <video autoPlay loop muted playsInline> and :144-154 showcase <video autoPlay loop muted playsInline controls>, both sourcing /api/video, no preload/poster/<track>; no matchMedia('prefers-reduced-motion') usage anywhere in src/.

**Fix:** Add preload="none" + poster and IntersectionObserver-deferred load to the showcase video; replace the barely-visible hero background video with a static image; add a captions track (or transcript) and gate autoplay behind a reduced-motion check.

---

### M4. Offset the Methodology in-page sticky nav below the sticky Header
**🔴 OPEN** · M12 · owner: `fable` · effort: S · category: ux  
**File:** `src/pages/MethodologyPublic.tsx:112`

**Problem:** The Methodology in-page nav is sticky top-0 z-40 while the marketing Header is sticky top-0 z-50, so the section nav slides underneath the header when scrolling.

**Evidence:** MethodologyPublic.tsx:92 renders <Header variant="marketing"/>; Header.tsx:102-105,120 applies sticky top-0 z-50; MethodologyPublic.tsx:112 in-page nav is sticky top-0 z-40 — same offset, lower z-index.

**Fix:** Set the in-page nav to top-[57px] (the Header's measured height) and add scroll-margin-top to the anchor sections.

---

### M5. Associate form labels with controls across EmissionForm, ContactUs, and Settings (14 unlabeled fields)
**🔴 OPEN** · M13 · owner: `fable` · effort: S · category: a11y  
**File:** `src/components/carbon-calculator/EmissionForm.tsx:71`

**Problem:** 14 labels across the core emission-entry form (Scope/Category/Source/Amount/Unit/Facility), the contact form (name/company/email/subject/message), and Settings org inputs have no htmlFor/id association, so screen readers announce unnamed selects and inputs.

**Evidence:** EmissionForm.tsx:71-183 six bare labels with controls at :74,94,115,141,157,174 lacking ids; ContactUs.tsx:89-115 five labels/controls unassociated; Settings.tsx:74-87 three more. Only 8 htmlFor usages exist codebase-wide (Login/Signup/Onboarding) vs 22 <label> elements — Onboarding.tsx:83-127 shows the correct pattern.

**Fix:** Add unique ids to each control and htmlFor on each label; add autoComplete="name"/"email"/"organization" to the ContactUs inputs.

---

### M6. Add pre-render inline theme script to prevent dark-mode FOUC
**🔴 OPEN** · M14 · owner: `fable` · effort: S · category: ux  
**File:** `src/hooks/useTheme.tsx:23`

**Problem:** The 'dark' class is toggled on <html> only inside a post-mount useEffect and index.html has no inline theme bootstrap, so dark-theme users get a white flash on every load (body defaults to bg-white until hydration).

**Evidence:** useTheme.tsx:23-26 classList.toggle inside useEffect; index.html:146 body class bg-white with no inline script before the module script at :148 reading localStorage 'eco-theme'/prefers-color-scheme.

**Fix:** Add a tiny blocking inline script in index.html <head> that pre-applies 'dark' from localStorage('eco-theme') / matchMedia before first paint (coordinate with the CSP unsafe-inline removal — use a nonce or hash).

---

### M7. Wire Settings general/team/templates/notifications to real data or gate them — currently fabricated and inert
**🔴 OPEN** · M2 · owner: `opus` · effort: M · category: ux  
**File:** `src/pages/Settings.tsx:75`
**Claim it contradicts:** 'Manage your organization, team, and preferences'; Pro sells 'Team permissions & roles'  

**Problem:** Org inputs prefill mock 'Northstar Foods'/'$47M' with defaultValue and no save path; the team tab shows three fake hardcoded @northstarfoods.com members ('Sarah Chen', 'Tom Bradley (CFO)', 'Maria Gonzalez'); Edit/Add Facility/Manage/Invite/Update payment/Download invoice/Apply template buttons have no onClick; notification 'toggles' are styled divs with cursor-pointer but no onClick, role, or keyboard support and hardcoded state; facilities render mock rows despite real /api/companies/:id/facilities endpoints existing unused.

**Evidence:** Settings.tsx:73-89 inputs with defaultValue={COMPANY.name}/revenue and no form/onSubmit/save; :94-103 mock FACILITIES with dead Edit/+ Add Facility; :113-128 hardcoded team array + dead Manage/Invite; :228 Update, :254 Download, :306 Apply — no handlers; :318-334 toggle divs with fixed enabled flags, no onClick/role/tabIndex (contrast the real switch at Pricing.tsx:65-72). Real endpoints exist unused (server.cjs:1339-1356); real company data is readable (carbon-calculator/index.tsx:41-45).

**Fix:** Load the user's companies row and bind/save org fields; drive facilities from /api/companies/:id/facilities; gate team/templates/notifications behind ComingSoon (removing the fake identities) or implement them; convert toggles to <button role="switch" aria-checked> with persistence.

---

### M8. Wire the dead sales CTAs on Pricing: Book demo (x3), Talk to sales, Book a demo, add-on 'Add' buttons
**🔴 OPEN** · M7 · owner: `fable` · effort: S · category: ux  
**File:** `src/pages/Pricing.tsx:134`
**Claim it contradicts:** Pricing page offers bookable demos and purchasable add-ons ('One-time & Add-on Services' incl. $1,500 setup)  

**Problem:** Every sales-capture control on the revenue-critical pricing page is a <button> with no onClick and no href — per-plan 'Book demo', the enterprise 'Talk to sales'/'Book a demo' pair, and all four add-on 'Add' buttons do nothing, silently dropping purchase intent (add-ons also have no Stripe price IDs so cannot be purchased at all).

**Evidence:** Pricing.tsx:134-136 per-plan 'Book demo' no handler; :164 add-on 'Add' no handler (ADD_ONS mockData.ts:269-274); :213-214 'Talk to sales'/'Book a demo' no handlers. Contrast the wired checkout button at :124-133 and the landing page's mailto Book a Demo (LandingPage.tsx:91, M7 partial fix).

**Fix:** Point demo/sales buttons at /contact (or the chatbot demo flow / the landing mailto); for add-ons either implement one-time Stripe checkout or replace with 'Contact sales' until supported.

---

### M9. Consolidate the two competing onboarding/company-creation paths
**🔴 OPEN** · M8 · owner: `opus` · effort: M · category: ux  
**File:** `src/components/carbon-calculator/Onboarding.tsx:39`

**Problem:** Client-side calculator onboarding and server auto-provisioning both create companies independently: a user landing on the dashboard first gets a default-named '<email> Organization' with a trial window and never sees calculator onboarding; one opening the calculator first creates a company with a real name but no trial_ends_at.

**Evidence:** Onboarding.tsx:39-43 inserts into companies client-side via InsForge (user-chosen name/industry, no trial_ends_at); server.cjs:297-343 ensureCompanyForUser auto-inserts '<email> Organization', industry 'other', trial_ends_at now()+14d on the first authenticated API call.

**Fix:** Pick one flow: have calculator onboarding call a server endpoint (which sets trial_ends_at), or drop the client insert and let the calculator rename the auto-provisioned company.

---

### M10. Handle 402 upgrade_required client-side and wire the orphaned UpgradePrompt and trial-status/billing endpoints
**🔴 OPEN** · owner: `fable` · effort: M · category: billing  
**File:** `src/components/UpgradePrompt.tsx:1`
**Claim it contradicts:** Code comment: 'Trial status endpoint (used by frontend after OAuth)' — no frontend caller exists  

**Problem:** No frontend code consumes /api/billing or /api/trial-status or handles the server's 402 { code: 'upgrade_required' } response, and UpgradePrompt.tsx is imported by nothing — trial expiry and plan gates are invisible to users, who just see raw generic error strings instead of an upgrade path.

**Evidence:** grep over src/ for 'upgrade_required', 'trial-status', 'trialEndsAt', and '402' returns zero matches; grep for 'UpgradePrompt' matches only its own file. Server emits 402 with requiredPlan at server.cjs:484-489 on the gated routes (:1233, :1391) and exposes GET /api/trial-status (:191) and GET /api/billing (:214) — all consumer-less; a lapsed 14-day trial (server.cjs:336-337) surfaces only as opaque errors.

**Fix:** Add a shared fetch wrapper detecting status 402 + code 'upgrade_required' that renders UpgradePrompt with requiredPlan; fetch /api/billing once at app load to show a trial-days-remaining/expired banner and gate UI affordances; or delete the dead endpoint/component if handled differently.

---

### M11. Decide and instrument the requirePlan/trial-status fail-open posture
**🟠 PARTIAL** · C1 · owner: `opus` · effort: M · category: billing  
**File:** `server.cjs:495`

**Problem:** Billing enforcement fails open in four places — requirePlan on DB error, requirePlan when no company row exists, /api/trial-status on error, and /api/billing with no DB — so any DB outage or provisioning failure silently grants unlimited free access with only log lines as evidence.

**Evidence:** server.cjs:493-496 requirePlan catch → return next(); :482 `if (!state) return next()` — a user whose ensureCompanyForUser insert failed (:344-347 returns null) is never gated; :207-210 /api/trial-status error path returns { trial: true, source: 'error-fallback' }; :216 /api/billing with no pgPool returns { active: true, plan: 'starter', status: 'trialing' }.

**Fix:** If fail-open is the product decision, add a metric/alert on the catch and no-company paths, and bound the no-row fail-open (retry ensureCompanyForUser inside requirePlan) so a permanently unprovisioned account cannot ride free indefinitely.

---

### M12. Send Google Consent Mode signals and honor revocation — GTM once loaded never unloads
**🟠 PARTIAL** · C6 · owner: `opus` · effort: M · category: privacy  
**File:** `src/components/GTMInitializer.tsx:8`
**Claim it contradicts:** Cookie banner implies rejecting/adjusting categories stops the corresponding tracking  

**Problem:** The core C6 fix landed (GTM loads only after explicit analytics consent; hardcoded gtag stack removed; GPC/DNT honored; consent invalidated on policy bump), but once loaded the container is never unloaded, GA cookies are never cleared, no Consent Mode defaults/updates are sent, and marketing-category consent is never forwarded — so revocation has no effect and container-internal tags run without marketing consent.

**Evidence:** Fixed: index.html has no gtag/GTM snippet; GTMInitializer.tsx:8-12 gates on consentState.consent.analytics; consent defaults false (consent-context.tsx:38-43); policy-version invalidation (:54-64); GPC/DNT auto-reject (:74-90). Remaining: no else-branch/teardown in GTMInitializer; gtm.ts:32-57 has no gtag('consent',...) calls; trackEvent gating (gtm.ts:14) stops only the app's own dataLayer pushes — GTM's built-in triggers keep firing; the marketing category (consent-context.tsx:4-9) is never forwarded to the container.

**Fix:** Push Consent Mode v2 defaults (all denied) into dataLayer before gtm.js, push updates mapping analytics→analytics_storage and marketing→ad_storage/ad_user_data/ad_personalization on every updateConsent; on revocation, reload after clearing consent or remove the script and delete _ga*/_gid cookies.

---

### M13. Remove the 'Join hundreds of SMBs' adoption claim on a beta product
**🟠 PARTIAL** · H4 · owner: `fable` · effort: S · category: claims  
**File:** `src/pages/LandingPage.tsx:327`
**Claim it contradicts:** 'Join hundreds of SMBs turning messy data into defensible emissions records' vs the 'Now in beta' hero badge  

**Problem:** Fake logos, fake dollar metrics, and testimonials were removed or clearly labeled illustrative composites, but the CTA banner still asserts a concrete customer base of 'hundreds of SMBs' for a product whose own hero badge says 'Now in beta'.

**Evidence:** Fixed: LandingPage.tsx:159-175 social-proof strip is feature claims only; :278-292 testimonials labeled 'Illustrative — composite examples'; $84K/$2M metrics gone (:184-204). Remaining: :327 'Join hundreds of SMBs...' vs :78 'Now in beta'.

**Fix:** Reword to a non-quantified line, e.g. 'Turn messy data into defensible emissions records — join the beta.'

---

### M14. Make session re-validation real and add 401 handling — the H6 interval is a no-op memory read
**🟠 PARTIAL** · H6 · owner: `opus` · effort: M · category: auth  
**File:** `src/App.tsx:129`
**Claim it contradicts:** Security page: 'Session timeout and automatic re-authentication' (Security.tsx:81)  

**Problem:** The 5-minute interval added to fix H6 calls insforge.auth.getCurrentUser(), but the SDK returns the in-memory cached session without any network check whenever one exists, so mid-session expiry/revocation is never detected; combined with the absence of any 401 interceptor on the app's raw fetch() calls, an expired token leaves users on a silently broken app instead of being refreshed or redirected to /login.

**Evidence:** App.tsx:129-147 ('H6: Re-validate session periodically') calls getCurrentUser() every 5 min. SDK dist/index.mjs:997-1001: getCurrentUser returns the TokenManager's in-memory session with no expiry check when one exists. No file in src/ handles HTTP 401 (grep); stripe.ts:117-119,143-145 surface error bodies as strings; Dashboard.tsx:52-57 throws generic errors with no login redirect; the SDK's auto-refresh applies only to its own requests, not raw fetch() using buildApiRequestInit's static header snapshot (src/lib/api.ts:7-14).

**Fix:** Call insforge.auth.refreshSession() in the interval (a real network call that fails when revoked) and set authStatus 'anon' on error; add a shared fetch wrapper (extend src/lib/api.ts) that on 401 attempts one refreshSession()+retry, else clears state and navigates to /login; route Dashboard/DataIntake/stripe calls through it.

---

### M15. Restrict the upload picker to CSV — advertised xlsx/pdf/png/jpg always fail
**🟠 PARTIAL** · M4 · owner: `fable` · effort: S · category: ux  
**File:** `src/pages/DataIntake.tsx:118`
**Claim it contradicts:** 'Drop utility bills, fuel invoices, freight docs' (LandingPage.tsx:106)  

**Problem:** Non-CSV files now produce an explicit error toast (partial fix) instead of silently disappearing, but the file picker still advertises .xlsx/.pdf/.png/.jpg that the handler rejects — every format the dialog offers except CSV fails with 'is not a CSV file — skipped'.

**Evidence:** DataIntake.tsx:118 accept=".csv,.xlsx,.pdf,.png,.jpg"; :84-87 handleUpload skips !file.name.endsWith('.csv') with an error toast.

**Fix:** Change accept to ".csv" and update button/help text to say CSV import (until other formats are actually processed).

---

### M16. Distinguish server errors from empty accounts — Dashboard masks any fetch failure as 'Your account is ready'
**🆕 NEW** · owner: `fable` · effort: S · category: ux  
**File:** `src/pages/Dashboard.tsx:104`
**Claim it contradicts:** 'Welcome to EcoAuditor — Your account is ready. Add your first emission entry' shown during outages and to users who have data  

**Problem:** emissions starts null and every error path (401 expired session, 500 — which any calculator Scope 1 entry causes today, network failure) sets error while leaving emissions null, so the `error && !emissions` branch renders the fresh-account onboarding card, hiding outages and telling customers with real data that their account is empty.

**Evidence:** Dashboard.tsx:32 emissions initialized null; catch at :71-80 sets error for every failure (the 400/403 special-case at :77 only re-nulls an already-null value); :104-122 renders the onboarding welcome card whenever error && !emissions. Three agents independently reported this.

**Fix:** Track HTTP status: render the onboarding card only for the documented no-company 400/403 case, redirect to /login on 401, and show a retryable 'Could not load emissions data' error card for network/5xx failures.

---

### M17. Compute or remove the hardcoded '0% vs prior' trend deltas on scope cards
**🆕 NEW** · owner: `fable` · effort: M · category: claims  
**File:** `emissions-engine.cjs:175`
**Claim it contradicts:** Scope cards display 'X% vs prior' period comparison  

**Problem:** toDashboardSummary hardcodes trend_vs_prior_period to zeros and the Dashboard renders them as computed '0% vs prior' comparisons (styled green) on every scope card — a fabricated year-over-year metric.

**Evidence:** emissions-engine.cjs:175 `trend_vs_prior_period: { scope1: 0, scope2: 0, scope3: 0 }`; Dashboard.tsx:151-163 reads the values and :352-354 renders `{scope.trend}% vs prior`.

**Fix:** Compute prior-period totals in the summary route (loadEmissionEntries for period-1 and diff) or remove the 'vs prior' element until implemented.

---

### M18. Invalidate the emissions summary cache on calculator inserts/deletes
**🆕 NEW** · owner: `fable` · effort: S · category: pipeline  
**File:** `server.cjs:1180`

**Problem:** /api/emissions/summary caches per company/period for 5 minutes and only CSV ingest clears it; calculator entries added/deleted via direct InsForge DB writes leave the dashboard showing stale totals for up to 5 minutes.

**Evidence:** cacheSet at server.cjs:1180 (5*60*1000); the only emissionsSummaryCache.clear() is in the CSV route (:1304). Calculator writes bypass the server via insforge.database inserts/deletes (carbon-calculator/index.tsx:91-104,111-114).

**Fix:** Drop the cache (single-company aggregation is cheap), shorten TTL to seconds, or route entry create/delete through a server endpoint that clears the company's cache key.

---

### M19. Fail loudly when auth is configured without DATABASE_URL — currently every data API 403s
**🆕 NEW** · owner: `fable` · effort: S · category: pipeline  
**File:** `server.cjs:318`

**Problem:** requireCompanyAccess depends on ensureCompanyForUser to attach company_id, which returns null without pgPool; InsForge user payloads carry no company metadata, so in an auth-only deployment shape every data endpoint returns a misleading 403 Forbidden.

**Evidence:** server.cjs:318-319 `if (!pgPool) return null;` → requireCompanyAccess (:298-301) leaves user.company_id unset → resolveAuthorizedCompanyId 403s on empty authorizedIds (server-security.cjs:76-78); authGuard's user comes straight from the InsForge auth endpoint with no company_id claim (server.cjs:252-263).

**Fix:** Fail loudly at startup when INSFORGE_BASE_URL is set without DATABASE_URL (they are co-dependent), or return 503 'storage not configured' instead of 403.

---

### M20. Make CSV parsing collect per-row amount errors instead of aborting the whole import
**🆕 NEW** · owner: `fable` · effort: S · category: pipeline  
**File:** `emissions-engine.cjs:193`
**Claim it contradicts:** DataIntake UI shows per-row 'Errors'/'Warnings' lists implying partial imports are supported  

**Problem:** parseEmissionCsv throws on the first row with a non-numeric amount, so the ingest route's per-row error collection never runs and a 500-row file with one bad cell is rejected wholesale with a single 400.

**Evidence:** emissions-engine.cjs:188-193 throws 'CSV row N has an invalid amount' inside .map(); the ingest route's per-row isolation only starts after parsing succeeds (server.cjs:1238,1249-1299) and its catch turns the parse throw into a blanket 400 (:1326-1328).

**Fix:** Collect invalid-amount rows into a returned errors list (or mark the row invalid) instead of throwing, letting the route import valid rows and report the bad ones.

---

### M21. Persist compliance sign-offs — the endpoint fabricates a completed sign-off without writing anything
**🆕 NEW** · owner: `fable` · effort: S · category: claims  
**File:** `server.cjs:1385`
**Claim it contradicts:** 'Q1 2026 emissions lock & sign-off' / reviewer sign-off implied by audit-trail marketing  

**Problem:** POST /api/compliance/:id/signoff returns {status:'completed', signed_off_at: now} without touching any table, so a legally meaningful attestation action is acknowledged but leaves no record — the opposite of the audit-defensibility claim.

**Evidence:** server.cjs:1385-1389: after requireCompanyAccess the handler immediately returns res.json({ success:true, data:{ id, status:'completed', signed_off_at: new Date().toISOString() } }) with no DB access; no signoffs table exists in migrations (only reports.signoff TEXT, initial-schema.sql:51, which this endpoint never touches).

**Fix:** Persist sign-offs (UPDATE reports SET signoff, or a compliance_signoffs table with user id + timestamp) and return the stored row; until then return 501 rather than fabricated success.

---

### M22. Fix static compliance deadlines — 'EU CSRD due 2025-01-01' returned as 'upcoming' in July 2026
**🆕 NEW** · owner: `fable` · effort: S · category: claims  
**File:** `server.cjs:1374`
**Claim it contradicts:** 'Compliance timeline tracking' / 'Monitor compliance deadlines' (chatbot); 'Filing & Compliance Tasks' (dashboard)  

**Problem:** /api/compliance/deadlines returns three static entries for every company, including a CSRD deadline more than 18 months in the past labeled 'upcoming' — wrong regulatory dates shipped by a compliance product.

**Evidence:** server.cjs:1374-1383 static array with 'EU CSRD', due_date '2025-01-01', status 'upcoming'; same stale date in emissions-engine.cjs:253; no date-aware or per-company logic; the dashboard's COMPLIANCE_TASKS are separately hardcoded mock (mockData.ts:64-70).

**Fix:** Compute status from the current date, source deadlines from a maintainable config with correct SB 253 (2026 Scope 1/2, 2027 Scope 3) and CSRD phase-in dates, and filter by company applicability from getComplianceStatus.

---

### M23. Prevent unlimited repeat trials (DB trial + Stripe trial stack and are re-grantable)
**🆕 NEW** · owner: `opus` · effort: M · category: billing  
**File:** `server.cjs:616`

**Problem:** Every signup gets a 14-day DB trial and checkout grants another 14-day Stripe trial with no check of prior subscription history, so a user can chain the DB trial into a Stripe trial (28 days) and cancel-and-recheckout during each Stripe trial to extend free access indefinitely.

**Evidence:** server.cjs:336-337 ensureCompanyForUser inserts trial_ends_at = now()+14d for every new user; :616-617 adds trial_period_days:14 whenever the client sends trial:true for an eligible price, with no lookup of subscription history or has_trialed flag; billingStateFromCompany treats 'trialing' as fully active (server-billing.cjs:2,86-92).

**Fix:** Before granting trial_period_days, check stripe.subscriptions.list({customer, status:'all'}) or persist a trial_used flag on the users/companies row from the first trialing webhook, and skip trials for returning customers.

---

### M24. Block trialing users from PATCHing onto trial-ineligible Pro for free
**🆕 NEW** · owner: `fable` · effort: S · category: billing  
**File:** `server.cjs:523`

**Problem:** PATCH /api/subscription swaps the price item without touching trial_end, and Stripe preserves the trial on item updates — so a user on a trialing Starter subscription can PATCH to planId 'pro' and get Pro (deliberately trial-ineligible at checkout) free for the rest of the trial.

**Evidence:** server.cjs:501-506 findActiveSubscription explicitly includes 'trialing'; :523-527 the update sets items/proration/cancel_at_period_end but no trial_end; resolvePlanPriceId accepts all six plan/cycle combos including pro (server-billing.cjs:19-25); the checkout route excludes Pro from trials with the comment 'prevent trial abuse on higher tiers' (server.cjs:589-592), which this route bypasses.

**Fix:** In the PATCH handler, when subscription.status === 'trialing' and the target plan is not trial-eligible, pass trial_end:'now' (with payment confirmation) or reject the change until the trial converts.

---

### M25. Handle past_due subscriptions — customers can't cancel/change and lose access on the first failed payment
**🆕 NEW** · owner: `fable` · effort: M · category: billing  
**File:** `server.cjs:501`

**Problem:** findActiveSubscription searches only 'active' and 'trialing', so a past_due subscriber gets 404 'No active subscription' from cancel/change endpoints; simultaneously ACTIVE_SUBSCRIPTION_STATUSES excludes past_due, so app access is revoked the moment the first payment retry fails while Stripe is still dunning; invoice.payment_failed is log-only.

**Evidence:** server.cjs:501-506 lists status:'active' then 'trialing' only; PATCH/DELETE (:511,537) then 404. server-billing.cjs:2 ACTIVE_SUBSCRIPTION_STATUSES = Set(['active','trialing']) → the subscription.updated webhook with 'past_due' (server.cjs:676-681) flips billingState.active false immediately (server-billing.cjs:86-92); invoice.payment_failed only logs (server.cjs:687-688).

**Fix:** Include 'past_due' in findActiveSubscription so customers can still cancel; define a dunning policy — either grace-period past_due in ACTIVE_SUBSCRIPTION_STATUSES or surface a 'payment failed — update card' banner via /api/billing before cutting access.

---

### M26. Fix Settings plan-change/cancel copy: immediate proration contradicted, unimplemented 90-day retention promised
**🆕 NEW** · owner: `fable` · effort: S · category: billing  
**File:** `src/pages/Settings.tsx:200`
**Claim it contradicts:** 'Plan changes take effect at the end of your current billing period. Prorated credits apply for upgrades.' / 'Your historical emissions data and reports will be preserved for 90 days.'  

**Problem:** Settings tells users plan changes apply at period end, but the server swaps the price immediately with create_prorations (users are charged now); the cancel dialog promises a 90-day data-retention policy that exists nowhere in the codebase.

**Evidence:** Settings.tsx:200 end-of-period copy vs server.cjs:523-527 stripe.subscriptions.update with proration_behavior:'create_prorations' (immediate swap); Settings.tsx:208-209 90-day preservation promise with no retention/purge logic anywhere in server.cjs or migrations.

**Fix:** Update the copy to 'upgrades apply immediately with prorated charges' (or implement period-end downgrades via subscription schedules); remove or substantiate the 90-day retention sentence and align with the Terms/data policy.

---

### M27. Remove the fake 'Stripe Webhook Events' developer panel from customer Settings (wrong endpoint URL)
**🆕 NEW** · owner: `fable` · effort: S · category: billing  
**File:** `src/pages/Settings.tsx:263`
**Claim it contradicts:** Five webhook events shown as 'configured'; endpoint documented as https://api.eco-auditor.app/webhooks/stripe  

**Problem:** The billing tab tells end users to configure webhook endpoints in 'your Stripe dashboard', shows five events with hardcoded 'configured' badges the client cannot know, and documents an endpoint URL that does not match the actual server route (POST /api/webhook) — an operator following it would register a URL that 404s into the SPA fallback.

**Evidence:** Settings.tsx:262-285: hardcoded array with status:'configured' for every event (:266-272), unconditional green badges (:278), and endpoint 'https://api.eco-auditor.app/webhooks/stripe' (:284); the real route is app.post('/api/webhook') at server.cjs:645; unregistered paths fall through to the SPA fallback (server.cjs:1542). Related dead scaffolding: stripe.ts:218-231 client-side WEBHOOK_HANDLERS are all no-ops.

**Fix:** Delete the panel (webhook config belongs in DEPLOY.md/ops docs) — or at minimum correct the endpoint to <APP_URL>/api/webhook and drop the fake badges; also remove the dead WEBHOOK_HANDLERS/handleWebhookEvent scaffolding from the client bundle.

---

### M28. Gate or back the in-app Methodology page — it presents mock boundaries/facilities/factor config as the tenant's methodology
**🆕 NEW** · owner: `fable` · effort: S · category: claims  
**File:** `src/pages/Methodology.tsx:1`
**Claim it contradicts:** 'Define how emissions are calculated, classified, and reported' — the document an auditor would rely on  

**Problem:** The in-app 'Methodology & Boundaries' page renders METHODOLOGY_SETTINGS and Northstar FACILITIES mocks (boundary type, base year 2024, Sacramento/Fresno/Portland facilities, 'active' factor libraries, Scope 3 activation) as if they were the customer's configuration, with a no-op market-based 'Enable' button and no data source — unlike its sibling stubs it was not ComingSoon-gated.

**Evidence:** Methodology.tsx:1 imports METHODOLOGY_SETTINGS, FACILITIES from mockData (mockData.ts:201-210,12-16); :19-36 mock boundary/years/regions; :58 'Enable' button no onClick; :69-79 Northstar facility cards; :86-101 hardcoded 'active' libraries; :108-122 hardcoded Scope 3 categories. No API calls in the file.

**Fix:** Gate with <ComingSoon featureName="Methodology & Boundaries"/> like Reports/Ledger, or persist per-tenant methodology settings and read facilities from /api/companies/:id/facilities.

---

### M29. Announce errors to screen readers — add role=alert to auth/checkout/billing error containers
**🆕 NEW** · owner: `fable` · effort: S · category: a11y  
**File:** `src/pages/Login.tsx:152`

**Problem:** Login, Signup, ContactUs, Pricing, and Settings render error text into plain divs with no role=alert or aria-live, so failed sign-in, sign-up, checkout, and billing actions are silent for screen-reader users.

**Evidence:** Login.tsx:152-156, Signup.tsx:214-218, ContactUs.tsx:118, Pricing.tsx:146-150, Settings.tsx:171-173 — no role/aria-live on any. Only DataIntake.tsx:138-139 (role=status) and Onboarding.tsx:131 (role=alert) announce.

**Fix:** Add role="alert" to each error container, matching the Onboarding.tsx:131 pattern.

---

### M30. Label the cookie-preferences checkboxes and make the modal a real dialog
**🆕 NEW** · owner: `fable` · effort: S · category: a11y  
**File:** `src/components/CookieConsentBanner.tsx:86`

**Problem:** All four checkboxes in the cookie preferences modal have no label association or aria-label (announced as unnamed checkboxes), and the modal wrapper lacks role=dialog, aria-modal, focus trap, and Escape handling; the 'Learn more' privacy link is a raw anchor causing a full reload.

**Evidence:** CookieConsentBanner.tsx:86-91, :98-103, :110-115, :122-127 — checkboxes beside <p> text with no htmlFor/aria-labelledby; modal wrapper :75-76 is a plain div; :27 <a href="/privacy"> instead of Link.

**Fix:** Give each checkbox an id with <label htmlFor>/aria-labelledby; add role="dialog" aria-modal aria-labelledby to the modal with focus trap and Escape close; swap the anchor for <Link to="/privacy">.

---

### M31. Fix text-surface-400 body text failing WCAG contrast (~2.46:1) in 115 places
**🆕 NEW** · owner: `fable` · effort: M · category: a11y  
**File:** `tailwind.config.js:27`

**Problem:** surface-400 (#9ca8a0) is used as foreground text in 115 places across 28 files, at roughly 2.46:1 contrast on white — far below WCAG AA 4.5:1 — often combined with 10px text-2xs (copyright lines, metric captions, confidence labels, the legal consent line on Login).

**Evidence:** tailwind.config.js:27 surface.400 '#9ca8a0' (≈2.46:1 vs white); grep 'text-surface-400' = 115 hits, e.g. Footer.tsx:74-75, LandingPage.tsx:95, DataIntake.tsx:258, Login.tsx:158. surface-500 (#6b7a70, :28) is ≈4.5:1 and passes.

**Fix:** Replace text-surface-400 with text-surface-500+ for readable light-mode text; reserve surface-400 for decorative/disabled elements and dark surfaces.

---

### M32. Make the sales chat widget usable on mobile and accessible
**🆕 NEW** · owner: `fable` · effort: M · category: ux  
**File:** `src/components/ChatbotWidget.tsx:186`

**Problem:** The chat window is hardcoded 380x540px anchored 20px from the right — on a 375px phone it overflows the viewport, clipping conversation and input; it ignores dark mode (hardcoded white/light hex); the input has no aria-label, replies are not in a live region so screen readers never hear them, and the window has no dialog semantics or Escape close.

**Evidence:** ChatbotWidget.tsx:144-146 fixed right/bottom 20px; :185-195 width 380px/height 540px with no vw clamp; :188,261,270 hardcoded light hex palette; :367-386 unlabeled input with outline:'none' (:380); :254-353 message container with no aria-live/role=log; no role=dialog/keyboard close. Rendered on the landing page (LandingPage.tsx:43).

**Fix:** Clamp to min(380px, calc(100vw - 24px)) / min(540px, calc(100dvh - 24px)) or a full-screen sheet at small breakpoints; use theme tokens; add aria-label to the input, role="log" aria-live="polite" on messages, and role="dialog" with Escape close + focus return.

---

### M33. Set per-route canonical URLs and titles — every page claims the homepage canonical
**🆕 NEW** · owner: `opus` · effort: M · category: seo  
**File:** `index.html:14`

**Problem:** The canonical link is hardcoded to https://ecoauditor.io/ in shared index.html and never updated per route, so /pricing, /methodology, /security, /sample-report, and all legal pages declare themselves duplicates of the homepage; legal pages never set document.title, and the useEffect-based title swaps cannot run in the renderToString prerender path.

**Evidence:** index.html:14 hardcoded canonical, no canonical manipulation anywhere in src/; document.title set only in MethodologyPublic.tsx:64, Pricing.tsx:26, SampleReport.tsx:34, Security.tsx:14 — all in useEffect, which does not execute in src/entry-server.tsx:20-29 renderToString, and never for /privacy, /terms, /dpa, /contact; sitemap.xml lists all nine URLs as distinct.

**Fix:** Update canonical per route (in scripts/prerender.mjs per output page, or a small head-manager on navigation) and add titles for the four legal pages.

---

### M34. Self-host Google Fonts instead of loading them pre-consent
**🆕 NEW** · owner: `fable` · effort: S · category: privacy  
**File:** `index.html:54`
**Claim it contradicts:** Consent banner 'We value your privacy' — yet Google receives every visitor's IP before any choice  

**Problem:** Every page load transmits the visitor's IP to fonts.googleapis.com/fonts.gstatic.com before any consent decision — the exact pattern German courts (LG München I, 3 O 17493/20) ruled a GDPR violation — and it runs in static HTML before the ConsentProvider mounts, so gating is impossible.

**Evidence:** index.html:54-56 unconditional preconnect + Inter/JetBrains Mono stylesheet; CSP whitelists the origins (server-security.cjs:7-8).

**Fix:** Self-host via @fontsource/inter and @fontsource/jetbrains-mono imported in src/index.css, delete the three link tags, and remove the Google font origins from DEFAULT_CSP.

---

### M35. Remove 'unsafe-inline' from CSP script-src
**🆕 NEW** · owner: `opus` · effort: M · category: security  
**File:** `server-security.cjs:6`
**Claim it contradicts:** Security page markets hardened infrastructure and 'regular security assessments'  

**Problem:** script-src includes 'unsafe-inline', neutralizing CSP as an XSS defense even though nothing requires inline executable scripts — the only inline block is non-executable JSON-LD and GTM is injected as an external script.

**Evidence:** server-security.cjs:6 `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com ...`; index.html:59 inline script is type=application/ld+json (not governed by script-src); GTM injected externally (gtm.ts:52-56). Note: img-src is also a blanket 'https:'.

**Fix:** Drop 'unsafe-inline' from script-src and verify app+GTM load; if the dark-mode FOUC fix adds an inline bootstrap script, use a nonce or move it to an external file; consider tightening img-src.

---

### M36. Resolve the privacy-policy contradiction with the Marketing consent category
**🆕 NEW** · owner: `fable` · effort: S · category: claims  
**File:** `src/pages/PrivacyPolicy.tsx:222`
**Claim it contradicts:** PrivacyPolicy.tsx:222: 'We do not use cookies for cross-site tracking or targeted advertising'  

**Problem:** The privacy policy asserts no targeted-advertising cookies and lists only Essential/Analytics/Preferences, while the consent banner asks visitors to consent to a 'Marketing — Personalized advertisements' category that is tracked and recorded server-side — the two legal surfaces contradict each other.

**Evidence:** PrivacyPolicy.tsx:216-222 vs CookieConsentBanner.tsx:117-127 (Marketing toggle) and consent-context.tsx:4-9 (marketing category, recorded at server.cjs:772).

**Fix:** Remove the Marketing category from the banner/consent model if no ad tech is used, or update Privacy Policy section 15 to disclose it; keep banner, policy, and GTM container contents consistent.

---

### M37. Disclose the AI/LLM subprocessor before forwarding visitor chat messages to Anthropic/OpenAI
**🆕 NEW** · owner: `fable` · effort: S · category: privacy  
**File:** `server.cjs:1017`
**Claim it contradicts:** DPA section 8: 'A current list of subprocessors is maintained in Annex III'  

**Problem:** Unmatched chat messages from anonymous visitors (routinely containing names, emails, company details) are forwarded verbatim to api.anthropic.com or api.openai.com, but neither the privacy policy nor DPA Annex III names any AI/LLM provider as a processor.

**Evidence:** server.cjs:1017-1031 POSTs the raw message to Anthropic; :1035-1049 to OpenAI; DPA Annex III (DataProcessingAddendum.tsx:246-251) lists only Cloud hosting/Stripe/Analytics/Email/Support; PrivacyPolicy.tsx:117 mentions 'AI-assisted features' but not third-party LLM APIs.

**Fix:** Add the AI provider(s) to DPA Annex III and the privacy policy; add a short in-widget notice ('AI responses powered by <provider>; do not share sensitive data'); consider stripping obvious PII before forwarding.

---

### M38. Sanitize chatbot lead capture like /api/leads — forged state bypasses all validation
**🆕 NEW** · owner: `fable` · effort: S · category: security  
**File:** `server.cjs:883`

**Problem:** Chatbot flows persist leads from fully client-controlled state without the bounds/email validation applied to /api/leads: a forged state object skips email validation entirely and allows multi-kilobyte fields into the lead store.

**Evidence:** server.cjs:883-891 and :924-930 call writeLead() with state.name/email/company from req.body.state, which the server echoes to the client (:996) and the widget resubmits verbatim (ChatbotWidget.tsx:94,108-110); the in-flow email regex (:857) only runs if the client follows the scripted steps. Contrast sanitizeLeadPayload on /api/leads (server-security.cjs:101-129).

**Fix:** Run the assembled lead through sanitizeLeadPayload (or equivalent boundedString + email checks) in the step:'time' and step:'message' branches before writeLead, rejecting/truncating forged state.

---

### M39. Add abuse controls to the unauthenticated AI chat fallback
**🆕 NEW** · owner: `fable` · effort: M · category: security  
**File:** `server.cjs:975`

**Problem:** /api/chat is public and, when a KB pattern misses, relays up to 5,000-char prompts to paid LLM APIs with only the global 120 req/min/IP limiter — an attacker rotating IPs can run unbounded third-party API spend.

**Evidence:** server.cjs:975-984 accepts unauthenticated messages up to 5000 chars; AI branch :1013-1052 calls Anthropic/OpenAI per request (max_tokens 1024); the only throttle is the app-wide limiter (:106-107) shared with all routes; sessionId (:977) is accepted but never used for limiting.

**Fix:** Add a chat-specific limiter (e.g. 10/min, ~50/day per IP+sessionId), cap AI-branch message length (~1000 chars), and enforce a server-side daily budget that degrades to the canned KB response when exceeded.

---

### M40. Show insert errors in the calculator Add Entry form instead of swallowing them
**🆕 NEW** · owner: `fable` · effort: S · category: resilience  
**File:** `src/components/carbon-calculator/EmissionForm.tsx:42`

**Problem:** EmissionForm.handleSubmit wraps onSubmit in try/finally with no catch and no error state; the parent throws on insertError, so a failed database insert becomes an unhandled rejection — the button flips back from 'Saving…' with no message and the entry silently isn't saved.

**Evidence:** EmissionForm.tsx:38-60 try { await onSubmit(...); ...reset } finally { setSubmitting(false) } — no catch, no error UI; index.tsx:91-106 `if (insertError) throw insertError;` propagates uncaught.

**Fix:** Add a catch setting an error string rendered near the submit button (match the error-card pattern at index.tsx:131-140) and only clear form fields on success.

---

### M41. Fix broken 512px icon reference in JSON-LD and web manifest
**🆕 NEW** · owner: `fable` · effort: S · category: seo  
**File:** `index.html:68`

**Problem:** Both the Organization JSON-LD logo and the PWA manifest 512x512 icon point to /android-chrome-512x512.png, which does not exist in public/ — the structured-data logo and installable-app icon 404.

**Evidence:** index.html:68 logo https://ecoauditor.io/android-chrome-512x512.png; public/manifest.webmanifest icons[1] same path; public/ contains favicon-512x512.png but no android-chrome-512x512.png.

**Fix:** Point both references to /favicon-512x512.png (or rename the file).

---

## ⚪ LOW (23)

### L1. Merge the duplicate Company/Contact footer columns and fix the 5-in-4 grid
**🔴 OPEN** · L1 · owner: `fable` · effort: S · category: ux  
**File:** `src/components/Footer.tsx:52`

**Problem:** The footer renders two nearly identical columns ('Company' and 'Contact') each containing the same Contact Us link, email, and phone (Contact Us appears a third time under 'Trust'), and the grid is md:grid-cols-4 with five children so the last column wraps alone.

**Evidence:** Footer.tsx:52-60 and :62-70 duplicate nav blocks; :48 Trust also links /contact; :9 grid grid-cols-2 md:grid-cols-4 with 5 children.

**Fix:** Delete one duplicate nav column (keep the aria-labelled 'Contact'), leaving four children.

---

### L2. Strengthen the signup password policy beyond 6 characters, client-side only
**🔴 OPEN** · L10 · owner: `fable` · effort: S · category: security  
**File:** `src/pages/Signup.tsx:171`
**Claim it contradicts:** Security page: 'SOC 2-aligned controls', 'enterprise-grade' access management  

**Problem:** The only password policy in the codebase is an HTML minLength={6} and a matching length guard on the signup button — below the NIST/OWASP 8-character floor, trivially bypassed via devtools, with no strength feedback; actual enforcement depends entirely on unverified InsForge defaults.

**Evidence:** Signup.tsx:171 minLength={6}, :172 placeholder 'at least 6 characters', :181 disabled gate password.length < 6; no other password validation in src/ or server.cjs.

**Fix:** Raise the client minimum to 8+ with a strength hint, and configure/confirm the InsForge project's server-side password policy to match.

---

### L3. Standardize on a single logo mark for Header and Footer
**🔴 OPEN** · L2 · owner: `fable` · effort: S · category: ux  
**File:** `src/components/Footer.tsx:13`

**Problem:** Header and Footer ship two unrelated brand marks: Footer renders a cyan/navy/green compass-leaf SVG with hardcoded hex colors while Header's EcoLogo is a brand-600 rounded square with a white path.

**Evidence:** Footer.tsx:13-23 (512 viewBox, #06b6d4/#1e3a5f/#52b788) vs Header.tsx:50-57 EcoLogo (28 viewBox).

**Fix:** Extract one logo component into a shared file and use it in both.

---

### L4. Add route-level code splitting
**🔴 OPEN** · L4 · owner: `fable` · effort: M · category: ux  
**File:** `src/App.tsx:7`

**Problem:** All 22 pages are statically imported into one bundle; no React.lazy/Suspense exists anywhere in src/.

**Evidence:** App.tsx:7-31 static imports of every page; grep for lazy|Suspense across src/ returns zero matches.

**Fix:** Convert app-shell routes to React.lazy with a Suspense fallback; keep the landing page eager for SEO/LCP.

---

### L5. Remove the duplicate manifest <link> in index.html
**🔴 OPEN** · L5 · owner: `fable` · effort: S · category: ux  
**File:** `index.html:51`

**Problem:** The web app manifest is linked twice on consecutive lines, causing a redundant fetch and console noise.

**Evidence:** index.html:50-51 — identical <link rel="manifest" href="/manifest.webmanifest" /> on both lines.

**Fix:** Delete line 51.

---

### L6. Remove the hardcoded GTM container ID fallback
**🔴 OPEN** · L7 · owner: `fable` · effort: S · category: privacy  
**File:** `src/lib/gtm.ts:4`

**Problem:** Any deployment without VITE_GTM_ID silently loads container GTM-PS2XR44V, streaming visitor analytics to a container the deployer does not control; the unset-env guard is unreachable dead code because GTM_ID is always truthy.

**Evidence:** gtm.ts:4 `const GTM_ID = import.meta.env.VITE_GTM_ID || 'GTM-PS2XR44V';` — the !GTM_ID guard at :35 can never fire.

**Fix:** Drop the string fallback so the existing guard short-circuits when unconfigured.

---

### L7. Use design tokens in CookieConsentBanner
**🔴 OPEN** · L8 · owner: `fable` · effort: S · category: ux  
**File:** `src/components/CookieConsentBanner.tsx:27`

**Problem:** The cookie banner and preferences modal use raw green-600/gray-* Tailwind classes instead of the app's brand/surface tokens — the only component off the design system.

**Evidence:** CookieConsentBanner.tsx:27,36,43,50 green-*/gray-* classes; modal checkboxes :90,102,114,126 likewise; no brand-* usage in the file.

**Fix:** Swap green-* for brand-* and gray-* for surface-* (cf. btn-primary/btn-secondary utilities).

---

### L8. Add target=_blank rel=noopener to the external suite interlinks
**🔴 OPEN** · L9 · owner: `fable` · effort: S · category: ux  
**File:** `src/components/Footer.tsx:82`

**Problem:** The external Developer312 suite links navigate in the same tab with no target/rel attributes.

**Evidence:** Footer.tsx:82 provenance-os.com and :84 sim-2-real.com anchors — no target="_blank" or rel="noopener noreferrer".

**Fix:** Add target="_blank" rel="noopener noreferrer" to both.

---

### L9. Stop the AuthCallback spinner in the error state and surface the OAuth provider's error reason
**🟠 PARTIAL** · M5 · owner: `fable` · effort: S · category: ux  
**File:** `src/pages/AuthCallback.tsx:36`

**Problem:** The substantive gap (no error surface) is fixed — error heading, message, and 'Back to login' link render — but the loading spinner still animates unconditionally alongside the error, and the SDK strips/swallows the provider's ?error= param before the page reads it, so users always get a generic message with no reason.

**Evidence:** AuthCallback.tsx:36 animate-spin div outside any conditional; :37-47 error-aware heading/CTA. SDK dist/index.mjs:746-751 detectAuthCallback cleans the error param and console.debug-swallows it; AuthCallback.tsx:13-18 only reports getCurrentUser's generic failure.

**Fix:** Wrap the spinner in {!error && ...}; capture new URLSearchParams(window.location.search).get('error') on first render (before the SDK cleans the URL) and include it in the message.

---

### L10. Guard webhook sync against out-of-order Stripe events (last-write-wins)
**🆕 NEW** · owner: `opus` · effort: M · category: billing  
**File:** `server.cjs:438`

**Problem:** syncSubscriptionRecord unconditionally UPDATEs the company row per webhook; Stripe does not guarantee delivery order, so a delayed customer.subscription.updated can overwrite a newer customer.subscription.deleted, reviving canceled access until the next event.

**Evidence:** server.cjs:438-451 unconditional UPDATE keyed on user_id; the handler (:664-692) applies created/updated/deleted identically with no comparison of event.created or stored recency.

**Fix:** Store the last-applied event timestamp (or status + current_period_end) and skip older events; or re-fetch the subscription from Stripe inside the handler and persist that authoritative state.

---

### L11. Guard ensureStripeCustomer against concurrent duplicate customer creation
**🆕 NEW** · owner: `fable` · effort: S · category: billing  
**File:** `server.cjs:389`

**Problem:** ensureStripeCustomer does SELECT-then-INSERT with no ON CONFLICT: two concurrent first-time billing calls (e.g. a double-clicked 'Start free trial') both create Stripe customers, the second INSERT violates the users PK and 500s, and the orphaned Stripe customer is never cleaned up.

**Evidence:** server.cjs:369-396: SELECT (:370), stripe.customers.create (:378), bare INSERT (:389-392); src/db/schema.ts:8 makes insforge_user_id the primary key.

**Fix:** Use INSERT ... ON CONFLICT (insforge_user_id) DO UPDATE ... RETURNING stripe_customer_id, and delete the extra Stripe customer if the returned ID differs from the one just created.

---

### L12. Pepper the consent-record IP hash — unsalted truncated SHA-256 of an IP is reversible
**🆕 NEW** · owner: `fable` · effort: S · category: privacy  
**File:** `server.cjs:779`
**Claim it contradicts:** server.cjs:745 comment: 'No raw IP is stored'  

**Problem:** The stored ipHash is a truncated unsalted SHA-256 of the client IP; the IPv4 space can be brute-forced in seconds, so this is reversible pseudonymization (still personal data under GDPR), contradicting the code's own 'no raw IP' claim.

**Evidence:** server.cjs:779 crypto.createHash('sha256').update(String(req.ip||'')).digest('hex').slice(0,32) — no salt/pepper; persisted with user_agent to consent_records (:786-789, migrations/20260703000000_add-billing-and-consent.sql:25).

**Fix:** Use createHmac('sha256', process.env.CONSENT_IP_PEPPER) with a server-only rotating secret, or drop the IP-derived field (visitorId + UA already provide dispute evidence).

---

### L13. Rate-limit and dedupe /api/consent-audit against flooding and forged records
**🆕 NEW** · owner: `fable` · effort: S · category: security  
**File:** `server.cjs:759`

**Problem:** The unauthenticated consent-audit endpoint lets any client insert ~120 rows/min/IP forever into consent_records with an arbitrary self-chosen visitorId — unbounded table growth and poisoning of the GDPR evidentiary trail.

**Evidence:** server.cjs:759-794: only the global limiter applies (:106-107), no per-visitorId dedupe, visitorId is client-supplied (:767; generated client-side, consent-context.tsx:96-99); each POST INSERTs (:785-790) into a table with no retention policy (add-billing-and-consent.sql:16-28).

**Fix:** Add a tight per-IP limiter (e.g. 5/min), skip inserts when the newest record for the visitorId has identical consent+policyVersion, and add a retention/pruning job.

---

### L14. Fix isAppPage prefix match — /apple, /application etc. are treated as protected app routes
**🆕 NEW** · owner: `fable` · effort: S · category: ux  
**File:** `src/App.tsx:83`

**Problem:** isAppPage uses location.startsWith('/app') with no boundary check, so any public URL beginning with '/app' triggers the authenticated shell: anonymous visitors are bounced to /login instead of the 404 page.

**Evidence:** App.tsx:83 `const isAppPage = location.startsWith('/app');` — /apple skips the public routes' NotFound catch-all (:268-279) and hits the auth gate (:184-193).

**Fix:** `const isAppPage = location === '/app' || location.startsWith('/app/');`

---

### L15. Redirect already-authenticated users away from /login and /signup
**🆕 NEW** · owner: `fable` · effort: S · category: ux  
**File:** `src/pages/Login.tsx:11`

**Problem:** Neither Login nor Signup checks for an existing session, so a signed-in user landing on /login or /signup sees the full form instead of being forwarded to /app.

**Evidence:** Login.tsx:11-53 and Signup.tsx:11-63 contain no getCurrentUser check or redirect; App.tsx:268-279 renders these routes unconditionally (the auth-check effect at :97-126 only runs when isAppPage).

**Fix:** In Login/Signup (or a shared PublicOnly wrapper), call insforge.auth.getCurrentUser() on mount and navigate('/app', { replace: true }) when a user exists.

---

### L16. Verify logout actually killed the server session — it can silently fail and resurrect
**🆕 NEW** · owner: `fable` · effort: S · category: auth  
**File:** `src/App.tsx:149`

**Problem:** The SDK's signOut swallows failures of the server logout call while clearing only the in-memory token, and the app additionally ignores signOut errors — if the logout request fails, the httpOnly refresh cookie survives and the 'logged out' user is silently re-authenticated on the next visit (a shared-machine risk).

**Evidence:** SDK dist/index.mjs:802-824 signOut wraps POST /api/auth/logout in try{}catch{} and returns {error:null} regardless; App.tsx:149-157 catches and proceeds to reload; getCurrentUser's refreshSession fallback (index.mjs:1002-1009) restores the session from the surviving cookie.

**Fix:** After signOut in handleLogout, call refreshSession()/getCurrentUser() to verify the session is gone; retry once and surface a 'Could not fully sign out on this device' warning if it persists.

---

### L17. Add a confirmation (and error toast) to one-click emission-entry deletion
**🆕 NEW** · owner: `fable` · effort: S · category: ux  
**File:** `src/components/carbon-calculator/EmissionList.tsx:67`
**Claim it contradicts:** 'Emissions Ledger — Immutable audit trail... version history' (landing)  

**Problem:** The trash icon deletes the row immediately with no confirm dialog and no undo — a UX hazard and a claims tension for a product marketed on an immutable audit trail; delete errors also surface nowhere.

**Evidence:** EmissionList.tsx:67-75 delete button calls onDelete(e.id) directly; index.tsx:110-118 hard-deletes and throws with no catch in the click path.

**Fix:** Add a confirm step (ideally soft-delete/audit-log) and catch delete errors into a toast.

---

### L18. Use router Links for Dashboard empty-state CTAs instead of full-reload anchors
**🆕 NEW** · owner: `fable` · effort: S · category: ux  
**File:** `src/pages/Dashboard.tsx:113`

**Problem:** 'Add Entry Now' in both the onboarding and empty states is a raw <a href="/app/calculator"> causing a full document reload (re-running auth bootstrap and the Loading screen), and uses one-off blue-600 styling instead of the btn-primary brand token.

**Evidence:** Dashboard.tsx:113-118 and :134-139 raw anchors with bg-blue-600; the rest of the app uses react-router Link/NavLink (App.tsx:293-319) and btn-primary (index.css:50-52).

**Fix:** Replace both anchors with <Link to="/app/calculator" className="btn-primary">.

---

### L19. Derive the reporting year — Dashboard hardcodes 'FY 2026' while the header computes it
**🆕 NEW** · owner: `fable` · effort: S · category: ux  
**File:** `src/pages/Dashboard.tsx:176`

**Problem:** Dashboard's 'FY 2026 Carbon Accounting Overview' subtitle and 'Reporting Year FY 2026' card are string literals while the app-shell header shows FY {new Date().getFullYear()} — they will disagree from January 2027 and neither reflects a tenant-configured reporting year.

**Evidence:** Dashboard.tsx:176 and :235 hardcoded 'FY 2026'; App.tsx:233 dynamic FY {new Date().getFullYear()}.

**Fix:** Derive the reporting year from company settings (or getFullYear() consistently) in both places.

---

### L20. Remove the duplicated copyright/subsidiary block on the Contact page
**🆕 NEW** · owner: `fable` · effort: S · category: ux  
**File:** `src/pages/ContactUs.tsx:152`

**Problem:** /contact renders its own '© Developer312 ... subsidiary of NIGHT LITE USA LLC' card while the legal layout already appends the global Footer containing the identical two lines — the boilerplate appears twice.

**Evidence:** ContactUs.tsx:151-154 inline card; App.tsx:175-177 legal layout renders <ContactUs/> then <Footer/>; Footer.tsx:74-75 same lines.

**Fix:** Delete the inline card and rely on the global Footer.

---

### L21. Delete dead client-side Stripe webhook handler stubs from the bundle
**🆕 NEW** · owner: `fable` · effort: S · category: billing  
**File:** `src/lib/stripe.ts:218`

**Problem:** src/lib/stripe.ts ships a browser-side WEBHOOK_HANDLERS map where all five handlers are (data) => { void data; } no-ops plus an exported handleWebhookEvent — leftover pre-C2 scaffolding that can never legitimately run in a client and misleads readers; real handling lives at POST /api/webhook.

**Evidence:** stripe.ts:218-231 no-op handlers and exported handleWebhookEvent; no frontend caller; real verification server-side (server.cjs:645-659).

**Fix:** Delete WEBHOOK_HANDLERS, handleWebhookEvent, StripeWebhookEvent, StripeEventType; update any tests referencing them. Optionally also prune now-unused mockData exports (CHAT_MESSAGES, SUGGESTED_PROMPTS, REPORTS, LEDGER_ENTRIES, SUPPLIERS).

---

### L22. Misc ARIA fixes: unnamed billing switch, dangling aria-controls, unnamed sidebar logo link, missing skip link
**🆕 NEW** · owner: `fable` · effort: S · category: a11y  
**File:** `src/pages/Pricing.tsx:68`

**Problem:** Four small ARIA defects: the Pricing monthly/annual switch has role=switch but no accessible name; DataIntake tabs declare aria-controls ids that exist nowhere and panels lack role=tabpanel; the icon-only sidebar logo Link has no aria-label (an unnamed link duplicating the adjacent text link); and no skip-to-content link exists anywhere, forcing keyboard users through the full nav on every page.

**Evidence:** Pricing.tsx:65-75 switch with only sibling label spans, no aria-labelledby; DataIntake.tsx:203 aria-controls={`tab-panel-${tab}`} with no matching ids (panels at :217,318,374 are plain divs; Settings.tsx:54-66 same pattern with no tab semantics); App.tsx:293-295 icon-only <Link to="/"><EcoLogo/></Link> with unlabeled SVG (:350-366); grep for 'skip' in src/ finds nothing.

**Fix:** Add aria-label to the switch; add ids + role="tabpanel" to the three DataIntake panels; aria-label the logo Link (or merge with the text link and aria-hide the SVG); add an sr-only focus:not-sr-only 'Skip to main content' anchor in the app shell and marketing Header.

---

### L23. InsForge localhost fallback — verified fixed (dev-only, fails closed in production)
**✅ FIXED** · L6 · owner: `fable` · effort: S · category: security  
**File:** `src/lib/insforge.ts:15`

**Problem:** The client now fails closed in production and only falls back to localhost in dev, with an exported isInsForgeConfigured guard used by consumers.

**Evidence:** insforge.ts:12-17 `baseUrl || (import.meta.env.DEV ? 'http://localhost:54321' : '')` with the 'Fail closed in production' comment; isInsForgeConfigured (:24) used by ContactUs.tsx:15.

**Fix:** 

---

## Appendix — Fix ownership split

`owner: opus` = architectural / cross-cutting / financial-or-data risk (verify before applying). `owner: fable` = localized, mechanical, low blast-radius.

- **Opus-owned:** 27 findings
- **Fable-delegable:** 70 findings

*Generated 2026-07-06 by the gated fable audit fleet + Opus synthesis. Verify each finding against the live deploy before acting.*