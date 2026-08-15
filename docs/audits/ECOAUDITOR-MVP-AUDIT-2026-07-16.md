# Eco-Auditor MVP Audit — 2026-07-16

**Scope:** Full-stack audit of the ecoauditor.io MVP — Express backend (`server.cjs`, `server-billing.cjs`, `server-security.cjs`, `emissions-engine.cjs`, migrations), React 19 frontend (`src/`, 61 files), and the **live production site** (verified with curl/fetch on 2026-07-16: headers, TLS, page inventory, API behavior, SEO/consent surface).

**Note:** `npm run lint` / `vitest` could not be executed in this session (shell approvals expired); findings below are from direct code reads and live probing. Run the test suite after applying fixes.

**Verdict: do not charge money yet.** Six Critical defects will detonate on day one (site down for `www` visitors, crash-loops from anonymous lead posts, fake billing state shown to real users, a broken paid-conversion funnel, and fabricated ledger writes). All are fixable; most Criticals are small, surgical patches.

---

## Summary by severity

| Severity | Count | Theme |
|---|---|---|
| **Critical** | 6 | Crash-loop DoS, fake billing UI, broken checkout funnel, fabricated ledger writes, mock intake data, www 526 |
| **High** | 12 | Billing enforcement bypass, double-charge, fail-open plan gate, 1000× factor bug, silent lead loss, draft legal pages, canonical/404 SEO damage, dead auth recovery, sold-but-unshipped features |
| **Medium** | 18 | Enforcement gaps, data integrity, abuse surface, UX dead ends, consent/analytics, resilience |
| **Low** | 14 | Hardening, hygiene, drift |

**Recommended fix order:** C1 → C6 (minutes, edge rule) → C2 → C4 → C3/C5 → H1 → H2/H3 → H4 → H5 → H10/H11/H12 → mediums.

---

# CRITICAL

## C1. Unauthenticated remote crash-loop: `/api/leads` and chatbot writes kill the process in Docker

**Evidence:** `Dockerfile:27-38` runs as non-root `appuser` but never creates `/app/.data`. `server.cjs:829-834` `writeLead()` does `fs.mkdirSync('/app/.data')` → `EACCES`. The `/api/leads` handler (`server.cjs:1177-1186`) and the chatbot lead path via `/api/chat` (`server.cjs:1090-1104` → `writeChatLead` → `writeLead`) call it with **no try/catch**. Express 4 does not catch async rejections, so the rejection hits `process.on('unhandledRejection')` → `process.exit(1)` (`server.cjs:1826-1829`).

**Impact:** Every contact/demo lead submission — and every chatbot flow completion — crashes the entire server in production. Railway restarts it; one anonymous curl in a loop keeps the service down. Deterministic, unauthenticated remote DoS **and** 100% lead loss on launch day.

**Fix:**
1. Wrap both paths so request-scoped failures return 500 instead of killing the process:
```js
app.post('/api/leads', express.json({ limit: '8kb' }), async function (req, res) {
  try {
    const lead = sanitizeLeadPayload(req.body);
    if (!lead.ok) return res.status(lead.status).json({ success: false, error: lead.error });
    await writeLeadAsync(lead.value);
    return res.json({ success: true, message: 'Lead captured successfully' });
  } catch (err) {
    log('error', 'Lead write failed', { error: String(err) });
    return res.status(500).json({ success: false, error: 'Failed to save lead' });
  }
});
```
Do the same around `getBotResponse`/`writeChatLead` in `/api/chat` (degrade gracefully to "we'll email you").
2. `Dockerfile`: `RUN mkdir -p /app/.data && chown appuser:appgroup /app/.data`
3. Better: write leads to Postgres (see H5 — `contact_submissions` already exists) and stop using the ephemeral filesystem entirely.
4. Reserve `process.exit(1)` for truly unrecoverable state, not request failures.

---

## C2. Settings → Billing shows every user a **fake** active subscription, card, and invoices — wired to real Stripe mutations

**Evidence (verified this session):** `src/pages/Settings.tsx:3,44-45`:
```ts
import { COMPANY, FACILITIES, BILLING_SUBSCRIPTION, INVOICES, PAYMENT_METHOD, PLANS } from '../data/mockData';
const sub = BILLING_SUBSCRIPTION;   // mockData.ts:226 — Growth annual, "active", renews 2027-01-15
```
`src/data/mockData.ts:226-250` hardcodes the subscription, 5 fake paid invoices, and `PAYMENT_METHOD` (Visa ••4242). The page never calls the real `GET /api/billing` (exists at `server.cjs:277`). "Cancel subscription" and "Change plan" fire **real** `DELETE/PATCH /api/subscription` against this fiction.

**Impact:** A trial user who never paid sees an active Growth plan, a Visa on file, paid invoices, and fake usage meters. Cancel/change-plan then errors confusingly (or cancels a real subscription while displaying fake renewal dates). Fabricated billing state in a paid product — misrepresentation and a support/chargeback magnet.

**Fix:** Delete the mock imports. On mount, fetch real state:
```ts
useEffect(() => {
  (async () => {
    const res = await fetch('/api/billing', buildApiRequestInit(insforge));
    if (res.ok) setBilling(await res.json());
  })();
}, []);
```
Render plan/status/`currentPeriodEnd`/`cancelAtPeriodEnd` from the response; hide Cancel/Change-plan when `status !== 'active'`; show "No payment method on file" instead of the fake card; remove the fake invoice table (link to the Stripe portal for invoices); keep `UpgradePrompt` for the `active:false` case.

---

## C3. DataIntake "Approve & Add to Ledger" / "Request Human Review" fabricate audit-trail writes

**Evidence (verified this session):** `src/pages/DataIntake.tsx:45-73` — both handlers are a 600 ms timer followed by a success toast:
```ts
// TODO: Replace with insforge.db.insert([{ ...extractedFields }]) when backend is wired.
await new Promise<void>((resolve) => setTimeout(resolve, 600));
showStatus('success', 'Record approved and added to the emissions ledger.');
```
No API call, no DB write. "Edit Fields" (`:75-78`) shows a success toast saying "coming soon."

**Impact:** The product's core promise is a defensible ledger. Telling a user a record was written when nothing was saved is worse than a missing feature — it fabricates the audit trail the whole product sells.

**Fix:** Until a real endpoint exists, remove both buttons (or gate the panel behind the `ComingSoon` pattern already used for Ledger/Reports). If the OCR preview stays as a demo, label it "Sample preview — not your data," disable the buttons, and **never** show a success toast for a no-op.

---

## C4. DataIntake shows mock files and a hardcoded fake OCR extraction to every account

**Evidence:** `src/pages/DataIntake.tsx:2,24,251,297-313` imports `UPLOADED_FILES, OCR_PREVIEW, FACILITIES` from mockData, pre-selects fake file #1 ("PG&E_bill_sacramento_Q1.pdf"), and selecting **any** file shows the same hardcoded 12-field OCR preview (`mockData.ts:107-123`). The Human Review Queue tab (`:401-438`) is 4 hardcoded rows with a dead Review button. A user's real successful CSV upload (via `/api/ingest/csv`) never appears in the list.

**Impact:** Fake files presented as the user's real intake data; users can't tell real from demo — in a tool whose entire value is data provenance.

**Fix:** Remove the mock imports. Render the files list from a real source (ingest jobs / `emission_entries` via API) with an empty state ("No files yet — upload your first CSV"); drop the OCR preview panel until OCR exists or mark it unambiguously as a sample.

---

## C5. Pricing CTA dead-ends every anonymous prospect; the post-signup `?checkout=` handoff has no handler

**Evidence:** `src/pages/Pricing.tsx:52-60` → `src/lib/stripe.ts:112-113`: anonymous visitors clicking "Start free trial" get a red **"You must be signed in to start checkout."** The intended recovery exists only as dead code: `Signup.tsx:86-91` navigates to `/app?checkout=${plan}_${billing}`, but **nothing in `src/` reads a `checkout` query param**, and nothing links to `/signup?plan=…`. Stripe's `success_url` lands on `/app?session_id=…` (`server.cjs:699`) and no component reads `session_id` either.

**Impact:** The paid conversion path is broken end-to-end: anonymous → error; signed-up user with plan intent → silently dropped on the dashboard, no checkout; returning payer → no confirmation.

**Fix:**
1. `Pricing.tsx` `handleCheckout`: check auth first — if `getAuthToken()` is null, `navigate(`/signup?plan=${planId}&billing=${billingCycle}`)`.
2. Add a checkout-resume effect in the app shell: read `searchParams.get('checkout')`, parse `plan_billing`, call `createCheckoutSession(...)`, `window.location.assign(url)` on success, then strip the param with `navigate('/app', { replace: true })`.
3. Handle `session_id` on return: success banner + billing-state refetch.

---

## C6. `www.ecoauditor.io` is hard-broken — Cloudflare 526 on every URL (verified live)

**Evidence (live, 2026-07-16):** `curl -sSI https://www.ecoauditor.io` → `HTTP 526` ("error code: 526"); same for www subpages. `http://www` 301s to the broken `https://www`. Edge cert is a valid Let's Encrypt wildcard, so the 526 is the **origin (Railway) presenting an invalid cert for the www hostname**. Apex is fine (200) and sends `HSTS max-age=31536000; includeSubDomains; preload`, so returning visitors are forced onto HTTPS on www with no workaround.

**Impact:** A large share of typed/pasted/word-of-mouth traffic uses `www.` — those users get an unbranded Cloudflare error page and no path to the product.

**Fix:** Add a Cloudflare Redirect Rule: `www.ecoauditor.io/*` → `https://ecoauditor.io/$1` (301), handled at the edge so the origin never sees `www` (minutes to deploy; more robust than fixing the origin cert). **Do not submit to the HSTS preload list until this is fixed** — the domain is not yet preloaded, which is good.

---

# HIGH

## H1. Billing/trial enforcement is bypassed by design — the app's main data path never touches the gated API, and onboarding can create trial-less companies

**Evidence:**
- Frontend reads/writes core data **directly to InsForge with the anon key**, bypassing the Express plan gate: `carbon-calculator/index.tsx:19-23` (select), `91-104` (insert `emission_entries`), `110-114` (delete); `Onboarding.tsx:39-43` (insert `companies`), `52-55` (insert `facilities`).
- `requirePlan()` exists only on Express routes (`server.cjs:547-568`). RLS policies (`migrations/20260611141026_initial-schema.sql:87-161`) check **ownership only**, never billing state.
- `Onboarding.tsx:39-43` inserts companies **without `trial_ends_at`**; server provisioning (`server.cjs:405-409`) sets it. A null trial → `server-billing.cjs:91` `isFuture(null)` false → `requirePlan` returns **402 forever** ("Your trial has ended" on day one), while `ensureCompanyForUser` never runs because the row exists.

**Impact:** Enforcement is simultaneously **leaky** (any expired/canceled/never-paid user can write data via the PostgREST API directly — trial expiry is not enforced where the data lives) and **broken** (legit new signups instantly paywalled if they onboard through the calculator path first).

**Fix:**
1. Make the Express API the only write path for `companies`, `facilities`, `emission_entries`, `reports`: revoke `INSERT/UPDATE/DELETE` from the `authenticated` role in RLS for those tables and route the frontend through the plan-gated endpoints.
2. Set the trial atomically regardless of creation path:
```sql
ALTER TABLE companies ALTER COLUMN trial_ends_at SET DEFAULT (now() + INTERVAL '14 days');
UPDATE companies SET trial_ends_at = created_at + INTERVAL '14 days' WHERE trial_ends_at IS NULL;
```
3. Optional defense-in-depth at the data layer: RLS `WITH CHECK` joining `companies` requiring `trial_ends_at > now() OR subscription_status IN ('active','trialing')`.

---

## H2. Double-charge path: `/api/checkout` never checks for an existing subscription

**Evidence:** `server.cjs:682-715` creates a Checkout session unconditionally. `findActiveSubscription` exists (`server.cjs:574-580`) but is only used in PATCH/DELETE. A customer with an **active** subscription who completes checkout again gets a **second concurrent subscription** — billed twice every period, and the webhook flaps the DB plan between the two subs.

**Fix:** Before creating the session:
```js
const existing = await findActiveSubscription(customerId);
if (existing) {
  return res.status(409).json({
    error: 'You already have an active subscription. Use plan change or the billing portal instead.',
    code: 'subscription_exists',
  });
}
```
Also gate the pricing CTA on `/api/billing` state in the frontend.

---

## H3. `requirePlan` fails open — a billing-check outage or missing `DATABASE_URL` silently disables all enforcement

**Evidence:** `server.cjs:547-566`: `if (!pgPool) return next();` and `catch { return next(); // fail-open }`. And `railway.env.example` — the deploy reference — **does not list `DATABASE_URL`** at all (nor `APP_URL`, any `STRIPE_PRICE_*`, or server-side `INSFORGE_BASE_URL`). Every failure mode defaults to "granted": `/api/trial-status` returns `{ trial: true, source: 'no-db' }` (`:256`) and `{ trial: true, source: 'error-fallback' }` (`:272`).

**Impact:** The single most likely production misconfiguration (Postgres not attached) yields a deployment where everyone has unlimited free access forever, with one warn line in logs.

**Fix:**
1. Fail closed on paying-feature routes: billing-check error → `503 { error: 'Billing status unavailable, retry shortly' }`.
2. Validate env at boot and refuse to start in production:
```js
if (process.env.NODE_ENV === 'production') {
  const required = ['DATABASE_URL','INSFORGE_BASE_URL','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_STARTER_MONTHLY','STRIPE_PRICE_GROWTH_MONTHLY','STRIPE_PRICE_PRO_MONTHLY','APP_URL'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) { console.error('Missing required env: ' + missing.join(', ')); process.exit(1); }
}
```
3. Document all of these in `railway.env.example`.

---

## H4. Emission factor unit bug: natural gas in GJ is overstated 1,000×

**Evidence (verified this session):** `emissions-engine.cjs:4`:
```js
natural_gas: { therms: 0.005302, mcf: 0.05302, gj: 50.68 },
```
Every other factor is **tonnes** CO2e/unit (therms ≈ 0.0053 t ✓). `50.68` is the EPA factor in **kg CO2/GJ**; in tonnes it must be `0.05068`. As written, 1 GJ "emits" 50.68 tCO2e — more than 1,000 therms.

**Impact:** Any customer entering natural gas in GJ (common outside the US and on utility bills) gets a ~1000× overstatement flowing into summaries, trends, PDF reports, and compliance outputs — in a product whose entire value proposition is calculation correctness.

**Fix:** Change to `gj: 0.05068` and add a regression test (`100 GJ → 5.068 t`). Audit every entry in `SCOPE1_FACTORS`/`MOBILE_FACTORS` for result-unit consistency and comment the expected unit per table.

---

## H5. Contact & demo forms silently fail while showing success — every web lead is lost

**Evidence:** `ContactUs.tsx:53` and `Demo.tsx:66,75-76` insert into `contact_submissions` with an `intent` field. The table (`migrations/20260611141026_initial-schema.sql:56-64`) has columns `name, company, email, subject, message` — **no `intent` column** → PostgREST rejects the insert. The InsForge SDK returns `{ data, error }` (it doesn't throw), and the code never checks `error`, so `setSubmitted(true)` runs regardless; the `catch` is dead code.

**Impact:** The two pages whose only job is capturing sales leads show success while the insert 400s in the background. 100% lead loss with false-positive UX — it'll look like "marketing isn't converting."

**Fix:**
```ts
const { error } = await insforge.database.from('contact_submissions')
  .insert([{ name, company, email, subject: form.subject, message: form.message }]);
if (error) { setSubmitError("We couldn't send your message right now."); return; }
setSubmitted(true);
```
(Drop `intent`, or add the column via migration.) Add an integration test asserting insert payload keys ⊆ table columns. Also route `/api/leads` writes to Postgres here to kill two birds (C1).

---

## H6. Billing portal / plan change / cancel silently disabled unless the publishable key was baked in at build time

**Evidence:** `src/lib/stripe.ts:137-139, 163-165, 192-194` guard on **build-time** `VITE_STRIPE_PK` only; `createCheckoutSession` correctly resolves the key at runtime from `/api/config/prices` (`:107`). With the designed runtime-config deployment, checkout works while portal/change/cancel all fail with "Stripe is not configured."

**Fix:** In all three functions, resolve the key at runtime exactly like `createCheckoutSession` does: `const config = await fetchPriceConfig(); const pk = config.pk || STRIPE_PK;`.

---

## H7. "Forgot password?" is a `mailto:` link — no self-serve reset exists

**Evidence:** `src/pages/Login.tsx:146-152` links to `mailto:hello@developer312.com?subject=Password%20reset%20request`.

**Impact:** Locked-out users at launch have no automated recovery; every reset is a manual support email (and an identity-verification anti-pattern).

**Fix:** Implement the InsForge SDK reset flow (`insforge.auth` password-reset request + a `/reset-password` route) per the auth SDK docs; until then, label the link honestly ("Email support to reset") or remove it.

---

## H8. Settings "General"/"Team" tabs are entirely fake and every control is inert

**Evidence:** `Settings.tsx:75-128`: `defaultValue={COMPANY.name}` ("Northstar Foods"), hardcoded teammates ("Sarah Chen / sarah@northstarfoods.com"), fake facilities; no Save button or submit handler; "Edit", "+ Add Facility", "Manage", "+ Invite Team Member", template "Apply", invoice "Download", payment "Update" have no `onClick`. Notification toggles (`:304-306`) are static `<div>`s — no state, no persistence, not keyboard-operable (no `role="switch"`/`tabIndex`/`aria-checked`).

**Fix:** For MVP, delete the Team/Templates/Notifications tabs and render only functional controls; show the real org name from `getCurrentUser()` profile (`App.tsx:116-121`). Wire company-profile persistence when the endpoint exists.

---

## H9. Paid-plan feature lists sell features that are "Coming soon" pages

**Evidence:** `src/content/pricing.ts:57-66` (Growth: "AI Carbon Assistant", "Supplier request hub", "QuickBooks & Xero integrations") vs `AIAssistant.tsx`, `Suppliers.tsx`, `Ledger.tsx`, `Reports.tsx` — all render `<ComingSoon />`. The landing feature grid (`LandingPage.tsx:262-281`) and FAQ advertise the same. A Growth subscriber paying $399/mo hits a Coming-soon gate on three of seven listed features.

**Impact:** Refund/churn risk and a potential deceptive-practices problem — not a style issue.

**Fix:** Move unshipped items to each plan's roadmap/locked copy until shipped, or un-gate the pages. Align `LandingPage` and FAQ claims with what's actually live.

---

## H10. Every page's canonical URL points to the homepage (verified live)

**Evidence:** All 12 prerendered pages contain `<link rel="canonical" href="https://ecoauditor.io/">` — verified on /pricing/, /methodology/, /security/, /privacy/, /terms/, /dpa/, /sample-report/, /demo/, /contact/, /login/, /signup/.

**Impact:** Tells Google every page is a duplicate of `/` — pricing/methodology/sample-report likely dropped from the index, killing the SEO the sitemap and llms.txt are built for.

**Fix:** Emit per-route self-referencing canonicals in `scripts/prerender.mjs` (e.g. `https://ecoauditor.io/pricing/`), matching the trailing-slash URLs actually served.

---

## H11. Soft-404s: nonexistent routes return HTTP 200 with homepage content (verified live)

**Evidence (live):** `/nonexistent-xyz` → `200`, byte-identical homepage. Same for `/features`, `/dashboard` (no redirect to login), `/app`, `/apple-touch-icon.png`. Unknown API GETs (`/api/emissions`, `/api/user`) also return `200 text/html` homepage instead of JSON 404 (`server.cjs:1798-1801` SPA fallback catches everything).

**Impact:** Infinite duplicate-content space for crawlers, wasted crawl budget, monitoring blind spots, and marketing content shown where the app should be.

**Fix:** Add `app.use('/api', (req,res)=>res.status(404).json({error:'Not found'}))` before the SPA fallback; return a real 404 status for unknown front-end routes (or at minimum for known-reserved paths); redirect `/dashboard` → `/login`.

---

## H12. All three legal pages display a "business draft — not reviewed by counsel" banner on the live, paid product (verified live)

**Evidence (live):** /terms/ contains (twice, incl. meta description): *"This page is provided as a business draft for review and should be reviewed by qualified legal counsel before publication."* Same banner on /privacy/ and /dpa/. Pages dated "Last updated: June 12, 2026."

**Impact:** The site sells $149–$999/mo compliance subscriptions while publicly admitting its ToS/privacy/DPA are unreviewed drafts — undermines enforceability and destroys trust with exactly the compliance-minded buyers being targeted. The DPA is a marketed feature ("GDPR-aligned DPA" on /security/).

**Fix:** Get counsel sign-off, remove the draft banners, bump "Last updated" dates. Until review is complete, this is a launch blocker for paid plans.

---

# MEDIUM

| # | Area | Finding & evidence | Fix |
|---|---|---|---|
| M1 | Calc | **Unknown eGRID region silently falls back to California's factor** — `emissions-engine.cjs:113` `?? EGRID_FACTORS.CAMX`. A typo or any of the ~17 real subregions not in the 9-entry table quietly gets 0.207 t/MWh, understating most of the country. | Throw on unknown subregion like Scope 1 does; expand the table to the full current eGRID set (or add a state→subregion map). |
| M2 | Calc | **Mobile combustion ignores `unit` entirely** — `emissions-engine.cjs:100-103` applies a per-gallon factor to whatever unit was submitted; 10,000 L of diesel computes as 10,000 gal (~3.8× overstatement). | Mirror the stationary-combustion pattern: per-source unit maps (gallons/liters), throw on unsupported units. |
| M3 | Billing | **Plan tiers not enforced; several data endpoints ungated** — every `requirePlan(...)` uses `'starter'` (`server.cjs:1287,1310,1331,1349,1508,1580,1603`); `GET /api/facilities/:id/emissions` (`:1540`), `GET /api/reports/:id/download` (`:1635`), `GET /api/ingest/status/:job_id` (`:1493`), and both compliance routes (`:1555,1561`) have **no** plan gate. | Gate all data-reading routes at `requirePlan('starter')`; gate multi-facility/report exports at growth/pro to match the pricing page. |
| M4 | Security | **Latent IDOR: authorization trusts `user_metadata`/`app_metadata` company IDs** — `server-security.cjs:46-70`; `tests/server-security.test.ts:27-36` blesses `user_metadata.companyIds`. InsForge doesn't return those fields today, but Supabase-style `user_metadata` is user-writable by design — full cross-tenant access if the backend ever adds it. | Delete the metadata branches; derive authorized company IDs exclusively from the `companies` table; change the test to assert metadata is *ignored*. |
| M5 | Abuse | **`/api/chat` is an unauthenticated, paid-AI endpoint with no dedicated rate limit** — `server.cjs:1090` has only the global 120 req/min/IP limiter; misses fall through to OpenAI/Anthropic calls (`:1132-1167`). | Add `perRouteRateLimit(10, 60_000)` to `/api/chat` (plus a daily cap or auth for the AI fallback), and 5–10/min limits on `/api/leads`, `/api/checkout`, `/api/portal`, `/api/subscription`. |
| M6 | Data | **Leads & consent audit trail live on the ephemeral container filesystem; `.data/` not in `.gitignore`** — `server.cjs:815-874`; every redeploy wipes leads; read-whole-file/rewrite per request loses concurrent writes; a local commit could publish names/emails/IP-hashes. | Insert leads into Postgres like the consent DB path; add `.data/` to `.gitignore`; if files must remain, append-only JSONL. |
| M7 | Scale | **Unbounded queries and in-memory growth** — `loadEmissionEntries` (`server.cjs:1188-1198`) selects all rows per company (no LIMIT), then `/api/emissions/trend` runs 12 `summarizeEntries` passes; `ingestJobs`/`generatedReports` Maps (`:76-77`) grow forever. | Aggregate in SQL (`GROUP BY` month/scope/category); cap entry loads with a warning; add TTL eviction to both Maps. |
| M8 | Infra | **`trust proxy: 1` is wrong if Cloudflare fronts Railway** — `server.cjs:92`; with a two-hop chain `req.ip` resolves to the Cloudflare egress IP, collapsing unrelated users into one rate-limit bucket (mass 429s). | Key rate limiting on the `CF-Connecting-IP` header (set by Cloudflare, not spoofable at the edge) and keep `trust proxy = 1`. |
| M9 | Data | **Compliance endpoint returns fabricated company attributes** — `server.cjs:1270-1272` reads only hardcoded `sampleCompanies`; any real company ID gets `{ revenue: 0, employees: 0, region: 'CA' }` → SB 253 "not_applicable" for everyone. | Load revenue/employees/region from the `companies` row (add columns); return `unknown` rather than a fabricated default. |
| M10 | UX | **Signup/Login can wedge in submitting state** — `Signup.tsx:67-96`, `Login.tsx:53-67`: `setSubmitting(false)` runs only after an unguarded `await`; an SDK rejection leaves the button spinning forever. | `try { … } catch (e) { setError(…) } finally { setSubmitting(false) }`. |
| M11 | UX | **EmissionForm writes unvalidated numbers straight to the DB** — `EmissionForm.tsx:36-41`: `-50` parses truthy and inserts via PostgREST with no server-side validation; free-text sources store `0 kg CO2e` at `confidence: 85`. Also all form `<label>`s lack `htmlFor`/input `id`. | Guard `!Number.isFinite(n) \|\| n <= 0` → inline error; block submit when preview ≤ 0 unless a known zero-factor source; add `id`/`htmlFor` pairs. |
| M12 | SEO | **`/demo` prerendered but never served** — `scripts/prerender.mjs:40-53` builds `static/demo/index.html`, but `PRERENDERED_ROUTES` (`server.cjs:1778-1782`) omits `/demo`; bare `/demo` falls to the SPA fallback with homepage title/meta. | Add `'/demo'` to `PRERENDERED_ROUTES`. |
| M13 | UX | **Public `/pricing` renders with no Header/Footer** — `App.tsx:293` mounts bare `<Pricing />`; `UpgradePrompt` (`:32`) sends in-app users to this headerless page. | Wrap public `/pricing` in the marketing layout; link in-app upgrades to `/app/pricing`. |
| M14 | UX | **Dashboard onboarding detection can never trigger on 400s** — `Dashboard.tsx:66,91` checks the message for `'400'`, but `statusText` is `"Bad Request"`. | Throw structured errors carrying `res.status`; branch on `err.status === 400 \|\| 403`. |
| M15 | Data | **"vs prior" trend is a hardcoded stub shown as a real metric** — `emissions-engine.cjs:242` returns `{ scope1: 0, scope2: 0, scope3: 0 }`; `Dashboard.tsx:204-216,293-295` renders "+0% vs prior" in green for every account. | Compute from prior-period entries in `toDashboardSummary`, or hide the trend line until real. |
| M16 | Privacy | **Consent revocation doesn't actually stop GTM** — `consent-context.tsx:183-187` flips state but the already-injected gtm.js keeps beaconing until reload. (Initial gating is correct — GTM never fires pre-consent.) | On revocation, remove the script element, delete `window.dataLayer`, and/or reload after persisting consent; longer-term adopt GTM Consent Mode. |
| M17 | Live | **"Continue with Microsoft" button advertised but not configured** — /login/ and /signup/ render it; live backend `public-config` returns only `["apple","github","google"]`. Clicking it fails at the conversion moment. | Configure Microsoft OAuth in InsForge, or remove the button (and sync `llms.txt`). |
| M18 | Live | **HTML documents served uncompressed (44–52 KB raw)** — `Cache-Control: no-cache, no-transform` defeats Cloudflare compression; static assets are fine (gzip + immutable). | Drop `no-transform` for HTML or add `compression` middleware in Express. |

---

# LOW

**Backend / infra**
- **L1.** CSP `script-src 'self' 'unsafe-inline'` (`server-security.cjs:6`) largely nullifies CSP's XSS protection; the live whitelist still includes googletagmanager/google-analytics though no GTM exists in any bundle. Move inline scripts to hashed external files or nonces; drop `'unsafe-inline'` and the dead whitelist entries.
- **L2.** `APP_URL` falls back to `http://localhost:3000` for Stripe success/cancel/return URLs (`server.cjs:699-700,728`) — a missing env var redirects paying customers to localhost after checkout. Covered by H3 boot validation.
- **L3.** Trial-policy inconsistency: `TRIAL_ELIGIBLE_PLANS` (`server.cjs:677-680`) is monthly-only while `trialEligiblePriceIds` (`server-billing.cjs:39-46`, imported but unused) includes annuals — annual checkouts silently grant no trial. Unify on one helper.
- **L4.** Internal errors echoed to clients (`server.cjs:1631`, `1306`, `1489`). Return generic messages; keep details in logs.
- **L5.** `.env.example:14` ships a real GTM container ID (`GTM-PS2XR44V`) — dev builds fire into the production container. Use `GTM-XXXXXX`.
- **L6.** `ensureStripeCustomer` race (`server.cjs:439-463`) — concurrent checkouts create duplicate Stripe customers. Serialize with `INSERT ... ON CONFLICT DO UPDATE` and re-read.
- **L7.** `apiAuthGuard` dev backdoor (`server.cjs:341-358`): `ALLOW_DEV_AUTH=true` on any non-production deploy authenticates everyone as `dev-user` with no token. Add a loud startup warning and require a shared dev-token header.
- **L8.** `past_due`/`unpaid` subscriptions lose access instantly (`server-billing.cjs:2`) while Stripe is still retrying the card — consider a short grace period.
- **L9.** Dashboard summary cache invalidated only by Express-side writes (`server.cjs:1323`) — direct-SDK writes leave stale totals. Resolves itself once H1 is fixed.
- **L10.** `X-Powered-By: Express` exposed on all responses (live). `app.disable('x-powered-by')`. Health endpoints also expose git SHA/uptime/`db: configured` — keep `/health` minimal publicly.
- **L11.** Sitemap lists redirecting (non-trailing-slash) URLs with stale lastmod; internal links 301 on every navigation. Emit trailing-slash hrefs and final URLs in the sitemap.

**Frontend**
- **L12.** `LandingPage.tsx:161` references captions track `/video/product-workflow.en.vtt`, but `public/video/` is empty → 404 track (WCAG 1.2.2 gap for the narrated demo). Ship the VTT or drop the `<track>`.
- **L13.** `utils.ts:148-151` `formatCO2e(NaN)` renders `"NaN kg"`; `pricing.ts:93-95` `resolvePriceId` reads `process.env` in a client bundle (dead export); `stripe.ts:226-239` ships six dead client-side webhook stubs; TODOs ship in `DataIntake.tsx:49,64,76` and `Footer.tsx:15`; `src/PRODUCTION_AUDIT_PROMPT_v2.md` sits inside `src/`. Clean up.
- **L14.** Skip-link target `#main-content` missing on most pages (only legal pages render it); mobile nav has no Escape-close or focus containment; `AuthCallback.tsx:21-36` has no timeout around `getCurrentUser()` (add a ~10 s `Promise.race` → error state); oversized CSV uploads surface raw parser errors (pre-check `file.size > 95_000`, parse `res.text()` defensively).

---

# Verified working (no action needed)

- **SQL injection:** every query parameterized; no string-interpolated SQL found.
- **Stripe webhook:** raw body + signature verification; plan derived server-side from price-ID allowlists — clients cannot set their own tier.
- **Express-route IDOR:** every tenant-scoped route funnels through `requireCompanyAccess` with DB-derived company IDs.
- **RLS:** deny-by-default, ownership-chained; `contact_submissions` insert-only.
- **Auth API locked down (verified live):** all `/api/*` data endpoints → `401` unauthenticated; no data leaks, no 500s. Input validation works on `/api/leads` and `/api/chat`.
- **No pre-consent tracking (verified live):** zero GTM/GA in HTML or JS bundles; cookie-consent markup present; no `Set-Cookie` on public pages.
- **Security headers otherwise strong (verified live):** HSTS 1yr, CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- **TLS/redirect hygiene on apex (verified live):** http→https 301, valid wildcard cert to Sep 8 2026; favicons/OG/manifest all 200 with correct types; JS/CSS immutable + gzipped; 27 MB hero video uses `preload="none"` with range support.
- **Content quality (verified live):** no Lorem ipsum/TODOs on any page; unique titles/descriptions; pricing consistent across homepage, /pricing, llms.txt; compliance claims properly hedged ("SOC 2 in progress", "does not guarantee compliance").
- **Frontend hygiene:** protected-route gating works; all frontend-called API endpoints exist server-side; ErrorBoundary wraps the app; no `console.log` leftovers; no hardcoded localhost in production paths.

---

# Verification checklist (after fixes)

1. `POST /api/leads` x20 on the Railway deploy → no restarts (`railway logs`), lead rows in Postgres.
2. New signup via `/signup?plan=growth&billing=monthly` → lands in Stripe Checkout → returns to `/app?session_id=…` → success banner + `/api/billing` shows trialing.
3. New signup via calculator onboarding first → Dashboard does **not** show "trial ended."
4. Expired-trial user calls PostgREST insert directly → rejected.
5. Settings → Billing on a fresh account → real trial state, no Visa ••4242, no invoices.
6. `100 GJ natural gas` → 5.068 tCO2e; unknown eGRID region → explicit error; 10,000 L diesel ≠ 10,000 gal.
7. Contact + Demo forms with network throttled → error shown on failure, row present on success.
8. `curl -I https://www.ecoauditor.io` → 301 → 200; `curl -I https://ecoauditor.io/nope` → 404; canonical of /pricing/ self-references /pricing/.
9. `/terms`, `/privacy`, `/dpa` → no draft banners.
10. `npm run lint && npx vitest run && npm run build` → clean.
