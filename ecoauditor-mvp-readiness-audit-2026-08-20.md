# EcoAuditor — MVP Launch Readiness Audit
**Date:** 2026-08-20 · **Target:** paid marketing launch Friday 2026-08-21 · **Commit base:** local `master` @ `C:\Users\embro\.openclaw\workspace\eco-auditor-deploy`

**Verdict: do not start paid traffic Friday without fixing E-1.** A newly signed-up user currently cannot use the product at all — the 14-day trial can never be provisioned, so every dashboard and calculation API returns HTTP 402 within seconds of signup. Everything else in this report is secondary to that.

Method: five parallel audit agents (conversion funnel, billing/revenue, security/authz, live-site, legal/accessibility) over the full source tree plus live fetches of ecoauditor.io. The four findings marked **[verified by me]** were re-checked line-by-line against source after the agents reported, because they are the ones that change the launch decision.

---

## Launch blockers (P0)

### E-1 — Every new signup is paywalled within seconds. The free trial can never start. **[verified by me]**

`server.cjs:928-936`, `server-billing.cjs:55-58`, `server.cjs:583`, `server.cjs:604`

`requirePlan` documents itself as skipping enforcement when the company row doesn't exist yet:

```js
// server.cjs:928-930
// Skips enforcement when no DB is configured (dev mode) or the
// company row does not exist yet (trial is provisioned on first data access).
const state = await loadBillingState(req.user.id);   // → null when no company row
const decision = planAccessDecision(state, minPlanId);
if (!decision.allowed) return res.status(decision.status).json(decision.body);
```

It does not skip. `planAccessDecision` denies a null state outright:

```js
// server-billing.cjs:56
if (!state || !state.active || !hasPlanAccess(state.plan, minPlanId)) {
  return { allowed: false, status: 402, ... code: 'upgrade_required' ... }
```

The only code that creates the company row *with a trial* is `ensureCompanyForUser` (`server.cjs:727-737`, `INSERT ... trial_ends_at ... now() + INTERVAL '14 days'`). It is reached only through `requireCompanyAccess`, which runs **inside** handlers that all sit **behind** `requirePlan('starter')` — `/api/calculate` (1770), `/api/emissions/summary` (1807), `/api/emissions/trend` (1833), `/api/ingest/csv` (1851), `/api/companies/:id/facilities` (2043, 2050), `/api/facilities/:id/emissions` (2099), `/api/companies/:id/compliance` (2114), `/api/companies/:id/reports/generate` (2145), `/api/reports/:id/download` (2177).

Circular: provisioning is gated behind the gate it is supposed to open.

The two endpoints that *could* break the cycle explicitly refuse to:

```js
// server.cjs:583  /api/trial-status
// No company yet — will be auto-provisioned on next API call
return res.json({ trial: true, trialEndsAt: null, source: 'pending' });

// server.cjs:604  /api/billing
// Company not provisioned yet — trial starts on first data access.
return res.json({ active: true, plan: 'starter', status: 'trialing', ... source: 'pending' });
```

The only non-gated route calling `requireCompanyAccess` is `/api/ingest/status/:job_id` (2030), which 404s without a pre-existing job id — unreachable for a new user.

**Failure scenario.** Friday, 9:04am. A visitor clicks your ad, signs up ("14-day free trial · No card required", `Signup.tsx:133`), lands on `/app`. `Dashboard.tsx:61` fires `/api/emissions/summary` → no company row → 402 → `Dashboard.tsx:126-137` renders the full-page paywall **"Your trial has ended. Reactivate a plan…"** — roughly 30 seconds after they created the account. Meanwhile `Settings.tsx` calls `/api/billing`, which cheerfully reports `status: 'trialing'`. The user sees "trial ended" and "trialing" simultaneously and has no path forward except paying.

**Fix (~6 lines):** in `requirePlan`, when `loadBillingState` returns null, call `ensureCompanyForUser(req.user)` and reload state before deciding — i.e. make the code do what its comment already claims.

**Related trap:** `src/components/carbon-calculator/Onboarding.tsx:59` inserts a company row client-side via InsForge **without `trial_ends_at`**. If that row lands first, `ensureCompanyForUser` finds it and never inserts the trial, so `billingStateFromCompany` (`server-billing.cjs:191`) yields `trialActive: false` permanently — a 402 that survives the fix above. Fixing E-1 mostly defuses this (the server row gets created on the first dashboard call, so Onboarding takes its `update` branch), but the client-side insert should still go.

---

### E-2 — The entire paywall is bypassable through the app's own calculator page **[verified by me]**

`src/components/carbon-calculator/index.tsx:91-104`, `Onboarding.tsx:70-73`, route at `src/App.tsx:460`

`/app/calculator` writes straight to InsForge with the user's own token, never touching the Express API where all plan enforcement lives:

```ts
// index.tsx:91-104 — no plan check on this path
const { error: insertError } = await insforge.database
  .from('emission_entries')
  .insert([{ scope: data.scope, ... company_id: company.id }]);
```

Same for `facilities` (`Onboarding.tsx:70-73`) and for reads (`index.tsx:19-63`). Every `requirePlan` / facility-cap / Scope-3 gate on the Express side is real and correctly implemented — and completely sidestepped here. Your own `plan-limits.json:2` states the rule: *"Every limit here MUST have a server-side check — if you add one with no enforcement, you are selling something you do not deliver."*

**Failure scenario.** Sign up free, ignore the paywalled dashboard, open `/app/calculator`: unlimited facilities, unlimited entries, and **Scope 3** (a Growth-tier feature) forever, with an expired trial or a canceled subscription, using nothing but your shipped UI.

Note the irony: while E-1 is live, this is the *only* way a new user can use the product.

**Fix:** route these writes through the plan-gated Express API, or add InsForge RLS policies that check billing state on `companies` / `facilities` / `emission_entries`. I did **not** attempt this one — it needs your InsForge project's RLS config, which isn't visible from the repo.

---

### E-3 — A current subscriber can be charged twice **[verified by me]**

`server.cjs:1068-1106`

`/api/checkout` validates the price and the customer, then unconditionally creates a new subscription session. It never calls `findActiveSubscription` — which exists at `server.cjs:955` and *is* used by PATCH and DELETE `/api/subscription`:

```js
const customerId = await ensureStripeCustomer(req.user.id, req.user.email);
const sessionParams = { mode: 'subscription', customer: customerId,
                        line_items: [{ price: priceId, quantity: 1 }], ... };
const session = await stripe.checkout.sessions.create(sessionParams);
```

**Failure scenario.** A Growth subscriber revisits `/pricing` to compare plans and clicks "Get started" on Pro. Stripe creates a *second* subscription on the same customer: **$399 + $999/month**. Worse, the DB keeps one snapshot per company and `syncSubscriptionRecord`'s ordering guard (`server.cjs:886-891`) compares only timestamps, not subscription IDs — so entitlement flaps between the two. Chargeback material.

**Fix (~5 lines):** call `findActiveSubscription(customerId)` first; if one exists, return 409 and send the client to PATCH `/api/subscription` or the billing portal.

---

### E-4 — Cross-tenant data access if InsForge `user_metadata` is client-writable **[verified by me]**

`server-security.cjs:46-70`, consumed at `server.cjs:697-703`

`requireCompanyAccess` correctly derives the user's real company from the DB by `user_id`. Then it hands off to `resolveAuthorizedCompanyId`, which authorizes against a **union** that includes user-controlled metadata:

```js
// server-security.cjs:56-67
addStringValues(ids, user.company_id);        // ← the legitimate, DB-derived one
addStringValues(ids, user.company_ids);
addStringValues(ids, user.user_metadata.company_id);
addStringValues(ids, user.user_metadata.company_ids);
addStringValues(ids, user.app_metadata.company_id);
```

Any `requested` id present in that set is allowed.

**Exploit scenario — conditional.** InsForge is Supabase-compatible, and in Supabase `user_metadata` (`raw_user_meta_data`) is writable by the account holder via `signUp({ options: { data } })` / `updateUser({ data })`. If that holds here, an attacker signs up with `user_metadata.company_id = "5"`, then walks sequential integer IDs (`server.cjs:1730` gates on `/^\d+$/`; companies/reports use serial PKs):

```
GET  /api/emissions/summary?company_id=5
GET  /api/companies/5/facilities
POST /api/companies/5/reports/generate
```

and reads another customer's emissions, facilities, and generated PDF reports.

**This is P0 if `user_metadata` is client-writable and a non-issue if it isn't** — I could not determine which from the repo. Check your InsForge project's metadata write policy before Friday. Either way the fix is cheap and lossless: your data model is strictly one company per user (`ensureCompanyForUser`), so authorize against the DB-derived `user.company_id` only and delete the metadata branches.

---

### E-5 — Analytics is dead in production: you cannot attribute a dollar of Friday's spend **[verified by me]**

`src/lib/gtm.ts:4`, `Dockerfile:11-18`, `railway.toml`, `railway.env.example`

`const GTM_ID = import.meta.env.VITE_GTM_ID || ''` is baked at **Vite build time**. The Dockerfile declares exactly three build args — `VITE_STRIPE_PK`, `VITE_INSFORGE_BASE_URL`, `VITE_INSFORGE_ANON_KEY` — and `railway.toml` passes those same three. `VITE_GTM_ID` appears **only** in `.env.example:14` (`GTM-PS2XR44V`), which Docker never reads.

So in the deployed image `GTM_ID === ''`, and `initializeGTM()` bails at `gtm.ts:35-38`. Setting the variable in Railway's runtime env will **not** fix this — it must be a build arg.

**Impact:** zero pageviews, zero conversions, no ROAS, nothing for the ad platforms to optimize against. You would be flying blind from the first click.

**Fix:** add `ARG VITE_GTM_ID` / `ENV VITE_GTM_ID=$VITE_GTM_ID` to the Dockerfile, a matching `[[build.args]]` block to `railway.toml`, and the var to `railway.env.example`.

**Compounding (P1):** even once GTM loads, there are no conversion events. `trackEvent` is called exactly once repo-wide, inside `trackPageView` (`gtm.ts:26`). Signup success (`Signup.tsx:72-79`), checkout start (`Pricing.tsx:60-62`) and checkout success (`App.tsx:292-303`) push nothing. Add `sign_up`, `begin_checkout` and `purchase` events with plan/value before you scale spend.

---

## Legal exposure worth holding the launch for

### E-6 — Your Terms promise a trial that your code does not deliver

`TermsOfService.tsx:112` vs `server.cjs:1092-1096`

ToS §9: *"No payment method is required to start a trial… If you do not add a payment method and select a paid plan before the trial ends, the workspace becomes read-only — **no automatic charge occurs**."*

The pricing-page trial creates a Stripe Checkout session with `subscription_data = { trial_period_days: 14 }` and **no** `payment_method_collection: 'if_required'` — Stripe collects a card by default and auto-charges at trial end. Your own claims register admits it (`claims.ts:40`): *"Starting a trial from the pricing page creates a Stripe Checkout subscription, which collects a card. At trial end without a paid plan… access is paused, not read-only."*

A trial that auto-converts while the published terms explicitly deny it is FTC negative-option / ROSCA and state auto-renewal territory (California ARL among them), and it is chargeback fuel the moment paid traffic converts. Two ways out: set `payment_method_collection: 'if_required'` so behavior matches the terms, or rewrite §9 to describe what actually happens. *(Not legal advice — worth a counsel read either way.)*

### E-7 — "No card required" shown on the exact path that requires a card

`Signup.tsx:133`, `LandingPage.tsx:119`, `prerender.mjs:78`

`Pricing.tsx:57` sends plan-intent users to `/signup?plan=…`, where they read *"14-day free trial · No card required"* — and are then forwarded straight into card-collecting Stripe Checkout (`App.tsx:306-319`). Suppress that line when `searchParams.get('plan')` is set, and drop "no card required" from the prerendered `/pricing` meta description.

### E-8 — Unsubstantiated price comparison, five days past its own review deadline

`claims.ts:60-66`, rendered at `Pricing.tsx:267`

Your claims register marks *"Typical consultant fees for a basic GHG inventory: $15K–$40K"* as `status: 'unverified'` with the caveat *"Remove if a defensible source cannot be cited"* and `review_due: '2026-08-15'`. Today is 2026-08-20 and it is still live. Same for *"Most teams are up and running quickly"* (`LandingPage.tsx:15,25` — also emitted as FAQ JSON-LD to Google). Cite a source or delete before ads run; objective comparative price claims are exactly what FTC substantiation and ad reviewers go after.

### E-9 — Privacy/Terms unreachable from three pages ads may land on

`MethodologyPublic.tsx:300-302`, `Security.tsx:171-173`, `SampleReport.tsx` (no `Footer` import)

`/`, `/pricing`, `/blog` and `/demo` render `<Footer />` with the Privacy/Terms/DPA links. `/methodology`, `/security` and `/sample-report` do not, and the marketing header nav carries no legal links either. Google and Meta both require an accessible privacy policy **from the ad destination** — any campaign pointed at those three risks disapproval. One-line fix each: render the shared `<Footer />`.

---

## Live-site findings (fetched 2026-08-20)

The infrastructure is genuinely in good shape: prerendering works on all 10 marketing routes, per-route titles/meta/canonical/OG are unique and well written, `robots.txt` and `sitemap.xml` are valid, unknown paths correctly return **HTTP 404**, `/api/video` and `/og-image.png` both serve real content, and the legal pages are complete with a named entity and no placeholder tokens. The problem is the message, not the plumbing.

| # | Sev | Finding | URL |
|---|-----|---------|-----|
| L-1 | P0 | 4 of 6 feature cards say **"Coming soon"** (AI Assistant, Emissions Ledger, Reporting Center, Supplier Hub) while the meta description promises "generate Scope 1-3 reports". Testimonials read *"What teams will be able to say"* / *"composite examples of the workflow we are building, not real customer quotes"* — directly contradicting the "Now live — open for business" badge one screen above. | `/` |
| L-2 | P1 | Meta says "Starter $149/mo, Growth $399/mo, Pro $999/mo"; the page defaults to the **Annual** toggle and displays **$124 / $333 / $833**. Price inconsistency between ad snippet and landing page is a classic disapproval trigger. | `/pricing` |
| L-3 | P1 | All 6 blog posts serve the **homepage** (200, homepage title + canonical) — SPA fallback sends the prerendered `index.html`. Every post URL is a soft duplicate of `/`; shared links show homepage previews. | `/blog/*` |
| L-4 | P1 | Blog index prerenders to `"Loading posts…"` with zero posts in HTML; `/blog` and post URLs absent from `sitemap.xml`. The API returns 6 complete posts — the content exists, it just isn't reachable by crawlers. | `/blog` |
| L-5 | P2 | Landing FAQ (and its FAQ JSON-LD, so Google can surface it as a rich result) claims present-tense support for *"California SB 253, EU CBAM, customer procurement"* reporting packages. `Reports.tsx:4` renders `<ComingSoon>`; `mockData.ts:115` says exactly one generic template exists. | `/` |
| L-6 | P2 | Chatbot asserts *"All plans include a 14-day free trial"* (`server.cjs:1417`). False for Pro (`pricing.ts:106` `trial: false`) and for all annual billing (`TRIAL_ELIGIBLE_PLANS`, `server.cjs:1063`). | `/` |
| L-7 | P2 | Off-brand contact `hello@developer312.com` on the contact page and in `llms.txt`, alongside the ecoauditor.io addresses. | `/contact` |
| L-8 | P2 | 404s return unstyled plain-text `Not found` (`server.cjs:2338`); the branded React 404 only renders on client-side nav. Status code is correct. | any |
| L-9 | P2 | `/methodology` meta claims factors from "EPA, eGRID, GLEC, and EXIOBASE"; the page lists only EPA, eGRID, IPCC AR5. | `/methodology` |

**Not verified:** `/login` and `/signup` could not be fetched (blocked by your own `robots.txt`, which is correct behavior). Since the entire conversion path funnels through `/signup`, **load it manually in a browser before Friday**. Also confirm `/forgot-password` doesn't 404 — it's missing from the server's prerendered-route list (`server.cjs:2295-2299`).

---

## Config gaps that will bite on deploy

- **`APP_URL` is undocumented and defaults to `http://localhost:3000`** (`server.cjs:1085-1086, 1164`). It appears in neither `.env.example` nor `railway.env.example`. If unset, every successful payment redirects the customer to a connection-refused localhost URL, and `/api/checkout/verify` — the fallback that saves you when a webhook is late — never runs.
- **`DATABASE_URL` is missing from `railway.env.example`** while production boot hard-requires it (`server.cjs:2373-2375`). Following the doc yields a crash-looping deploy.
- **The six `STRIPE_PRICE_*` vars plus `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` are still listed as unfinished human actions** in `LAUNCH-READINESS-2026-08-17.md`, and `pricing.ts:7-10` still carries the unresolved checklist item *"Reconcile monthly/annual here against the live Stripe price amounts."* If unset, every buy button 400s with "Invalid plan selection". If set but mismatched, you charge a price you didn't advertise.
- **If `STRIPE_WEBHOOK_SECRET` is missing, the webhook 503s every event** (`server.cjs:1176-1179`) and there is no reconciliation fallback beyond the one-shot return-from-checkout hop. Month-1 signups would look fine, then **every paying customer gets paywalled at their first renewal** while Stripe keeps billing them (`server-billing.cjs:186-190`).
- **`VITE_STRIPE_PK` gates cancel/change/portal client-side** (`src/lib/stripe.ts:166, 192, 221`) even though those calls don't need it — the server builds the portal URL. If the image was built before Stripe vars were set, customers can subscribe (checkout falls back to the runtime value at `stripe.ts:103`) but then get *"Stripe is not configured"* when they try to cancel. A customer who can't cancel disputes instead.

---

## Accessibility on the conversion path

- **Signup and Login have no visible labels** (`Signup.tsx:141,154`, `Login.tsx:95`, `PasswordInput.tsx:59`). Every label is `className="sr-only"`, leaving placeholders at **2.46:1** contrast (`#9ca8a0` on white; 4.5:1 required) as the only visible cue — and they vanish on typing. WCAG 1.4.3 / 3.3.2 failure on your primary conversion form. Your Contact form (`ContactUs.tsx:142`) already does this correctly; copy that pattern.
- **Error text below threshold on tinted panels**: `#dc2626` on `bg-risk-high/10` = **4.13:1** — used for the auth error (`AuthShell.tsx:94`), contact error (`ContactUs.tsx:131`) and checkout error (`Pricing.tsx:186`). These are the exact messages a user must read to recover a failed signup or payment. Comparison-table checkmarks are **3.30:1** (`Pricing.tsx:280`).
- **Pricing billing toggle is 1.38:1** (`Pricing.tsx:82`) against the page — needs 3:1 (WCAG 1.4.11), and monthly-vs-annual state is conveyed only by knob position against an effectively invisible track. Given L-2, the toggle defaulting to annual is also a conversion issue.
- **No skip link anywhere** (0 repo-wide matches); marketing header puts 5 nav links + 2 CTAs before `<main>`.

---

## Verified working — no action needed

Worth recording, because a lot of this is solid and the P0s above shouldn't obscure it:

**Billing.** Price IDs are allowlisted server-side and client-sent `planId`/`billing` are ignored (`server.cjs:1052-1077`) — no price injection. Webhook signatures are verified against the raw body with no global `express.json()` to corrupt them. Out-of-order webhooks are rejected by the `subscription_event_at` guard, so a stale "active" can't resurrect a canceled sub. `/api/checkout/verify` confirms the session's customer matches the caller's own before granting entitlement — a stolen `cs_...` id grants nothing. Cancel/delete events correctly revoke access.

**Security.** SQL is parameterized throughout, including the dynamically-built CSV bulk insert. CORS is not wildcarded and auth is a bearer header, so CSRF doesn't apply. The dev-auth bypass is genuinely production-safe (`server-security.cjs:32-34`). Rate limiting is present and correctly keyed with `trust proxy` set (global 120/min, consent 10/min, leads 5/10min, chat 10/min). `/api/chat` is a regex knowledge base, not an LLM — no billing-DoS surface. CSV upload is capped at 100kb with no filenames accepted. Password reset doesn't enable enumeration; login blocks open redirects. No hardcoded secrets in tracked source. Security headers (HSTS, nosniff, `frame-ancestors 'none'`, referrer policy) are all set — though CSP carries `'unsafe-inline'` in `script-src`, which is worth removing given `BlogPost.tsx:173` uses `dangerouslySetInnerHTML`.

**Consent.** GTM does **not** fire pre-consent — `GTMInitializer.tsx:8-12` gates on `consent.analytics`, defaults are all-off, and GPC/DNT auto-reject. (Gaps: no Google Consent Mode v2 signals at all, so any ad tag in the container fires on analytics consent alone; and withdrawal doesn't unload an already-loaded container until the next page load.)

**Honesty.** Testimonials are prominently disclosed as composites. No fake logos, customer counts, or accuracy percentages anywhere. SOC 2 is correctly stated as "in progress (Q3 2026)", not claimed. The sample report is labeled "Every figure on this page is fictional." The SEC climate-rule claim correctly notes the rule was withdrawn. `trust-facts.ts` gates unverified facts behind a sentinel the build checks for. The four stub pages render an honest `ComingSoon` and are only reachable via sidebar items badged "Soon". Plan prices are internally consistent everywhere they appear, and "Save ~17%" is arithmetically correct. `useFocusTrap` is correctly wired to the cookie modal, mobile drawer, and chatbot, with focus restore.

---

## Suggested order for Friday

1. **E-1** — trial provisioning. Without this there is no product to advertise.
2. **E-4** — confirm whether InsForge `user_metadata` is client-writable. If yes, fix before any traffic.
3. **E-5** — GTM build arg, or you spend blind.
4. **E-3** — duplicate-subscription guard.
5. **Config** — `APP_URL`, `DATABASE_URL` in the Railway doc, the six `STRIPE_PRICE_*`, webhook endpoint registered. Then run one real end-to-end trial signup and one real checkout per plan.
6. **E-6 / E-7 / E-8 / E-9** — the legal and ad-policy set. Cheap copy changes, expensive if skipped.
7. **L-1 / L-2** — decide whether the landing page's "Coming soon" density and the $149-vs-$124 mismatch are what you want a cold click to land on.
8. **E-2** — the InsForge side-door. Needs RLS work; not a same-day fix, but it's revenue leaking from day one.
