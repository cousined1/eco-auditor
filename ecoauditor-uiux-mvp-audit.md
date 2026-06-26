# Eco-Auditor — UI/UX MVP Audit

**Target:** `https://ecoauditor.io/`
**Audit date:** 2026-06-25
**Method:** Live `web_fetch` of the production homepage + discoverability search. Raw server response inspected (pre-hydration HTML).
**Auditor note:** This is an evidence-grounded audit. Findings are split into **Verified** (directly observed in this fetch) and **Verify-against-DOM** (cannot be confirmed because the page renders client-side and the rendered UI was not reachable from this environment). Nothing in the second section is asserted as fact.

---

## 0. Scope & honest limitations

The production server returns an **empty `<body>`** — only `<head>` metadata and a Google Tag Manager `<noscript>` iframe were present in the response. There is no server-rendered or prerendered content in the default response. Everything visible to a human is injected by JavaScript after hydration.

Consequence for this audit: I can fully assess the **document/meta/rendering layer** (what crawlers, link unfurlers, and no-JS clients receive), but I **cannot** see hero copy, the signup funnel, dashboard, button states, empty states, or mobile layout from a raw fetch. Those are listed as explicit checks for you to run against the rendered DOM. I have deliberately **not** invented findings for things I couldn't see.

---

## 1. Verified findings (observed in this fetch)

### P0 — Empty-body / CSR-only render
- **Evidence:** Markdown extraction of the live page returned zero body content — only `<head>` tags and the GTM noscript link. No `<h1>`, no hero text, no nav, no fold content in the source.
- **Why it's P0 for an MVP marketing+app site:**
  - Any crawler or AI agent without JS execution sees an empty page → near-zero organic discoverability.
  - Link previews that don't execute JS fall back to OG tags only (those are fine here), but **the page itself** is blank to a large class of bots.
  - First Contentful Paint is gated entirely on the JS bundle parsing + hydrating. On a cold mobile connection this is the difference between "loads instantly" and "white screen for 2–4s."
- **Action:** Move the marketing surface (home, pricing, features) to SSR/SSG/prerender so the first byte contains real content. On your stack this is the Next.js App Router default — if the body is empty, something is forcing full CSR (e.g. a top-level `"use client"` wrapping the whole tree, or a misconfigured static export). **Verify the deployed build is actually the SSR/prerendered build and not a stale CSR artifact.** This matches the recurring "stale prerendered build surviving Railway deploys" pattern across the portfolio — treat it as the same root cause until proven otherwise.

### P1 — No organic search footprint
- **Evidence:** A targeted search for the product's own pricing/features pages surfaced only competitor listicles ("best carbon accounting software 2026"). Eco-Auditor did not appear in any comparison list, nor did its own indexed pages surface.
- **Interpretation:** Consistent with the P0 above — if Googlebot rendered the empty shell during initial crawls, indexing would be thin or absent. This is a *symptom*, not an independent defect; fixing P0 is the precondition for fixing this.
- **Action:** After SSR is confirmed, submit/refresh the sitemap in Search Console and request re-indexing of the core routes.

### Verified positives — keep these
The `<head>` is genuinely well-built for an MVP. Don't regress it during the SSR fix:
- Complete Open Graph set: `og:title`, `og:description`, `og:image` (1200×630 with `og:image:alt`), `og:url`, `og:type`, `og:site_name`, `og:locale`.
- Complete Twitter card set: `summary_large_image`, title, description, image + alt, site handle.
- `canonical` present and self-referential.
- `meta-robots: index, follow` (correct — you *want* indexing).
- Sensible `description` and `keywords`, clear positioning ("Carbon accounting as easy as bookkeeping," Scope 1–3, GHG Protocol, SMB).
- `theme-color`, Apple PWA meta (`apple-mobile-web-app-*`), `viewport` all present.

The messaging in the meta layer is sharp and benefit-led. The problem is purely that **none of it reaches the body**.

---

## 2. Verify-against-DOM checklist (could not be observed — run these on the rendered app)

These are the standard MVP UX failure points for a data-upload SaaS targeting non-expert SMB buyers. I'm giving you the checklist rather than guessing outcomes. Prior portfolio audits flagged a broken conversion funnel and missing Microsoft SSO on this product — I could **not** re-verify either in this fetch, so treat them as open items to confirm against the live DOM, not as current findings.

### 2.1 First-impression / hero (rendered)
- [ ] Is there a single, unambiguous primary CTA above the fold, visually dominant over secondary actions?
- [ ] Does the hero state the outcome (audit-ready Scope 1–3 report) and the effort (upload a bill) within one glance?
- [ ] Is there one proof element (logo strip, a number, a sample report thumbnail)? MVPs usually have none and lose trust.
- [ ] Cumulative Layout Shift: does the hero jump as JS hydrates? (Likely, given CSR — measure it.)

### 2.2 Signup / activation funnel
- [ ] Count the clicks from landing → account created → first value (first emissions number shown). Target ≤3 screens to *some* value.
- [ ] SSO options: confirm which providers actually work end-to-end. Test Google **and** Microsoft (SMB/finance buyers are heavily M365). Prior note suggested Microsoft SSO may be absent — confirm.
- [ ] OAuth round-trip: verify PKCE `code_verifier` survives the redirect and `*_CLIENT_SECRET` is set in the deployed env. (This exact class of failure has bitten sibling products — check it deliberately, don't assume.)
- [ ] Email/password path: is there inline validation, or only on submit? Is the error copy human?
- [ ] Is there a way to see value **before** signup (interactive demo / sample report)? For a "is this worth my time" SMB buyer this is the single highest-leverage activation lever.

### 2.3 Core task: upload → classify → report
- [ ] Upload affordance: drag-and-drop *and* file picker? Accepted formats stated up front (PDF bill, CSV, XLSX)?
- [ ] What happens on a bad/unsupported file — clear recoverable error, or silent failure?
- [ ] Processing state: is there a determinate progress indicator, or a spinner with no ETA? Bill OCR/classification is slow enough that an unexplained wait reads as "broken."
- [ ] AI classification: can the user **see and correct** how a line item was categorized (Scope 1/2/3)? Auditability is your entire value prop — if classification is a black box, finance buyers won't trust the output.
- [ ] Report output: can they preview before export? Export formats (PDF for auditors, CSV for analysts)? Is the GHG Protocol alignment visible *in* the report?

### 2.4 Empty / zero / error states
- [ ] First-run dashboard before any data: does it guide the next action, or show empty charts / hardcoded zeros? (Hardcoded dashboard zeros have appeared elsewhere in the portfolio — confirm these are real bound values, not placeholders.)
- [ ] Are loading skeletons used, or does content pop in after a blank gap?
- [ ] Network/API failure: is there a retry affordance and a non-technical message?

### 2.5 Trust, pricing & conversion (critical for this category)
- [ ] Is pricing visible without a sales call? SMBs self-serve; a "contact us" wall kills MVP conversion.
- [ ] Is the GHG Protocol / methodology / emission-factor source stated somewhere a skeptical buyer can find it? "Audit-ready" is a claim that needs backing.
- [ ] Data handling: where does the uploaded bill go, who can see it? A one-line security/privacy statement near the upload reduces drop-off.
- [ ] Any SOC 2 / security claims — confirm they're accurate and not overstated for the current state. (Inconsistent compliance claims have surfaced in sibling audits; don't ship a claim you can't substantiate.)

### 2.6 Accessibility & responsive (rendered)
- [ ] Single `<h1>`, logical heading order, real landmark elements (the empty shell tells us nothing here — check post-hydration).
- [ ] All interactive controls keyboard-reachable and focus-visible.
- [ ] Color contrast on the dark-green brand (`#14532d`) against text/CTAs ≥ 4.5:1.
- [ ] Forms: every input has a programmatic `<label>`; errors announced, not color-only.
- [ ] 320px width: does the upload flow and dashboard survive a narrow viewport without horizontal scroll?

### 2.7 Performance (rendered)
- [ ] LCP, CLS, TBT on a throttled mobile profile. CSR-only sites routinely fail LCP — measure before/after the SSR fix.
- [ ] JS bundle size on the marketing routes — they shouldn't ship the whole app bundle to render a static landing page.

---

## 3. Prioritized fix order

| Priority | Item | Verified? | Effort | Why |
|---|---|---|---|---|
| **P0** | Empty body → SSR/prerender the marketing + content routes; confirm deployed build isn't a stale CSR artifact | ✅ Verified | M | Gates discoverability, FCP, and trust simultaneously |
| **P1** | Re-index after SSR fix (sitemap + Search Console) | ✅ Verified (symptom) | S | Recover organic footprint |
| **P1** | Confirm OAuth (Google + Microsoft) works end-to-end; add Microsoft SSO if absent | ⚠️ Verify | S–M | Direct signup blocker for M365-heavy SMBs |
| **P1** | Make AI Scope classification visible + correctable | ⚠️ Verify | M | Core to the "audit-ready / trustworthy" promise |
| **P1** | Pre-signup value (sample report or interactive demo) | ⚠️ Verify | M | Highest-leverage activation lever for cold SMB buyers |
| **P2** | Self-serve pricing visible; methodology/factor source stated | ⚠️ Verify | S | Conversion + trust |
| **P2** | Real empty/loading/error states (no hardcoded zeros) | ⚠️ Verify | S–M | First-run experience defines retention |
| **P2** | A11y + contrast pass; responsive at 320px | ⚠️ Verify | S | Table stakes; cheap once UI is stable |
| **P2** | Marketing-route bundle split / perf budget | ⚠️ Verify | M | LCP follows from SSR + lighter bundles |

---

## 4. Quick wins (low effort, do this week)
1. **Confirm the deploy.** Diff the deployed `/` against a local production build. If local renders content and prod is empty, it's a stale/CSR build mismatch — same root cause as the rest of the portfolio. Fix the deploy pipeline, not the React.
2. **Re-fetch as Googlebot** (Search Console "URL Inspection → Live test"). This tells you definitively whether Google sees content or the empty shell.
3. **One trust line above the fold** once content renders: methodology source + "your data stays private." Costs nothing, measurably reduces bounce in this category.
4. **Don't touch the `<head>`** — it's the strongest part of the site. Preserve it through the SSR change.

---

## 5. What I could not assess (so you don't over-read this report)
- Rendered visual design, layout, copy hierarchy, and brand execution.
- The actual signup, upload, classification, and report flows.
- Real performance numbers (need a rendered, instrumented run).
- Whether prior-flagged items (broken funnel, missing Microsoft SSO, hardcoded zeros, compliance-claim consistency) are still present — **all listed as verify-against-DOM, none assumed.**

The fastest way to convert the entire Section 2 checklist from "verify" to "verified" is to fix P0 first: once the page renders server-side, a re-fetch will expose the real DOM and a second pass can audit it directly.

---

## 6. Repo reality vs audit doc (post-investigation, 2026-06-25)

The audit above was written from a raw `web_fetch` only — honest about what it could not see. After grounding in the actual repo (`C:\Users\embro\.openclaw\workspace\eco-auditor-deploy`), several assumptions and several "verify-against-DOM" items are now resolved.

### 6.1 Stack correction — this is NOT Next.js

The P0 action text speculates the empty body is a Next.js App Router misconfiguration or a "stale prerendered build surviving Railway deploys." Neither is the cause.

- **Actual stack:** Vite 8 + React 19 + react-router-dom v7 + Express (`server.cjs`) on Railway. Confirmed in `package.json`, `vite.config.ts`, `src/main.tsx`.
- **Actual cause of empty body:** This is a pure client-side-rendered SPA. `index.html` ships `<div id="root"></div>` + a module script; `main.tsx` calls `createRoot(...).render(...)`. Crawlers that don't execute JS see an empty body **by design**, not by deploy regression. There is no stale build; the deploy pipeline (`Dockerfile` → `npm run build` → `node server.cjs`) is correct and has been all along.
- **Implication:** The "diff deployed `/` against a local production build" quick-win in §4 is a red herring — they will match. The real fix is to *add* prerendering that the project never had. See §6.3.

### 6.2 Verify-against-DOM items now RESOLVED from source

These were open in §2 because the rendered DOM wasn't reachable from the audit environment. Reading the source settles them:

| §2 item | Status | Evidence |
|---|---|---|
| 2.2 Microsoft SSO | **Resolved — present** | `src/lib/socialAuth.ts:9-13` wires `azure` provider ("Continue with Microsoft"); `Login.tsx:138-150` + `Signup.tsx:201-212` render the buttons; `AuthCallback.tsx:12-25` completes the round-trip. Commit `ad41fc0` updated the social-auth test for the Microsoft provider. |
| 2.2 GitHub SSO | **Resolved — absent (intentional?)** | No GitHub provider in `socialAuth.ts`. Google, Microsoft, Apple are wired. |
| 2.2 PKCE / `*_CLIENT_SECRET` | **Resolved — N/A architecture** | OAuth is delegated to the InsForge SDK via `auth.signInWithOAuth({ provider, redirectTo })` (`socialAuth.ts:34-47`). The app only holds `VITE_INSFORGE_BASE_URL` + `VITE_INSFORGE_ANON_KEY` (`insforge.ts:3-15`); no client secrets live in the frontend. PKCE/secret handling is InsForge's responsibility, not this repo's. |
| 2.5 Pricing visible without sales call | **Resolved — visible** | `Pricing.tsx:78-105` shows Starter/Growth/Pro prices with a monthly/annual toggle and comparison table; not a "contact us" wall. A sales CTA exists only for custom needs (`Pricing.tsx:206-215`). |
| 2.5 Methodology / GHG Protocol source stated | **Resolved — present** | `MethodologyPublic.tsx:90-107, 128-190, 265-270` names GHG Protocol, EPA/eGRID/GLEC/IPCC/EXIOBASE with data-quality tiers and FAQ. |
| 2.5 Security/privacy near upload | **Partial — exists, not on upload page** | Trust language lives on `Security.tsx:54-103` and `PrivacyPolicy.tsx:102-109, 160-170` (TLS 1.3, AES-256, RBAC, retention). `DataIntake.tsx` itself has no inline trust line — the §4 "one trust line above the fold" quick-win still applies to the upload surface. |
| 2.5 SOC 2 claims accuracy | **Resolved — accurate** | `Security.tsx:64-103` says "SOC 2 Type II audit in progress" and "SOC 2-compliant hosts" — no overstated completed certification. |
| 2.3 AI Scope classification visible + correctable | **Open — gap confirmed** | `DataIntake.tsx:76-109, 217-314` is upload→OCR→review but does NOT show AI Scope (1/2/3) classification. Scope is only set manually in the Carbon Calculator (`EmissionForm.tsx:24-50, 62-203`). This is a real product gap, not a render artifact. Out of scope for this redeploy. |
| 2.4 Hardcoded zeros | **Resolved — bound, not placeholder** | `Dashboard.tsx:124-142` treats zero totals as an explicit empty/onboarding state, not fake numbers. `mockData.ts:136` `completeness: 0` is fixture data for the sample view. |

### 6.3 P0 fix shipped in this commit — build-time prerendering

The empty-body problem is real and is the highest-leverage fix (gates discoverability, FCP, and trust). It cannot be fixed by re-deploying the existing build; prerendering had to be added.

**What shipped:**
- `src/entry-server.tsx` — SSR entry exporting `render(url)` using `StaticRouter` + the same `ThemeProvider`/`ConsentProvider`/`App` tree as the client. All browser-only access in those providers was already guarded with `typeof window !== 'undefined'`, so `renderToStaticMarkup` is safe.
- `scripts/prerender.mjs` — runs after `vite build`. Compiles the SSR entry via Vite's SSR build, reads `static/index.html` as the template, renders each marketing route, injects the markup into `<div id="root">`, and writes `static/index.html` (for `/`) or `static/<route>/index.html`. Routes mirror `public/sitemap.xml`: `/`, `/pricing`, `/methodology`, `/sample-report`, `/security`, `/contact`, `/privacy`, `/terms`, `/dpa`. App routes (`/app/*`) are auth-gated and excluded — they would snapshot a "Loading…" shell.
- `package.json` — `build` is now `tsc -b && vite build && node scripts/prerender.mjs`. Exits non-zero if any route fails to render, so a regression is loud.
- `server.cjs` — added explicit handlers for the 8 non-root prerendered routes (crawlers hit bare `/pricing`, not `/pricing/`, so `express.static` alone wouldn't serve the file). Falls back to the SPA shell only if a prerender artifact is missing. `/app/*`, `/login`, `/signup`, `/auth/*` still hit the SPA fallback as before.
- `src/components/ChatbotWidget.tsx` — moved a `localStorage.getItem` call out of a `useState` initializer (which ran during SSR render and crashed `/`) into a `useEffect`. This was a latent SSR bug that prerendering surfaced.
- `.gitignore` — added `.ssr` (the prerender scratch dir, cleaned up after each build).

**Verified locally:**
- `npm run build` → 9/9 routes prerendered (root 37,117 chars; largest legal page `/dpa` 43,972 chars).
- `static/index.html` body now contains the hero `<h1>` and "Start Free Trial" CTA (confirmed via grep of the `<body>` slice).
- `static/pricing/index.html` body contains `<h1>` and "Starter"/"Growth" plan names.
- `npm test` → 95/95 pass.
- Smoke test against `node server.cjs` on port 4399: `/` → 200 + hero present; `/pricing` → 200 + "Starter" present; `/app` → 200 + SPA shell (correctly not prerendered).

**After this redeploy, a raw `web_fetch` of `https://ecoauditor.io/` should return real body content for the 9 marketing routes.** The §2 checklist items that depend on a rendered DOM (2.1, 2.6, 2.7) can be re-run on the next audit pass against the live prerendered HTML.

### 6.4 What this commit does NOT do

- Does not touch the `<head>` (the strongest part of the site per §1 — preserved).
- Does not change auth, upload, classification, or report flows.
- Does not add the missing AI Scope classification on the intake page (§6.2 — separate product work).
- Does not add a `/features` or `/about` route (the Header's `/features` is an in-page anchor on the landing page, not a missing route).

