# HUMAN ACTIONS — Eco-Auditor Launch Audit (godmythos v10.7.1 FIX/REVIEW pass)

**Audit date:** 2026-07-15  **HEAD:** `2168f2b` (master)
**Applied this session:** 4 safe FIX-NOW items (H21, H5, M15, M33) — see `git diff`.
**This file:** findings that touch the never-auto-apply domains (auth, billing,
cryptography, migrations, security headers, methodology) per the SaaS launch
audit skill Phase-4 rules. Each has a proposed minimal diff for human approval.

None of the items below were applied. They require a named owner, a product
or security decision, or production/provider access.

---

## SEC-1 (M35) — CSP `unsafe-inline` in `script-src`  · owner: Security  · P1

**Why IDE access is insufficient:** CSP is a production security header; a
wrong policy breaks the live site (inline theme script, GTM, analytics) and a
weak policy leaves XSS exposure. Needs a deploy + browser verification.

**Evidence:** `server-security.cjs:6`
`"script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com"`
(and `style-src 'self' 'unsafe-inline'` at line 7).

**Proposed fix:** move inline scripts to a per-request nonce and drop
`'unsafe-inline'` from `script-src`; keep `'unsafe-inline'` on `style-src` only
if Tailwind runtime styles require it (otherwise nonce those too). Template:
```js
// server-security.cjs — generate a nonce per request, attach to inline scripts
const crypto = require('crypto');
// in buildSecurityHeaders: const nonce = crypto.randomUUID().replace(/-/g,'');
// "script-src 'self' 'nonce-${nonce}' https://www.googletagmanager.com ..."
// render inline <script nonce="${nonce}"> in static/index.html + App theme script
```
**Verify:** `curl -sS -D - "$APP_URL/" | grep -i content-security-policy` shows
no `unsafe-inline` in `script-src`; GTM + theme + analytics still load; no
console CSP violations in a real browser.

---

## AUTH-1 (H18) — No password reset / forgot-password flow  · owner: Engineering  · P1

**Why IDE access is insufficient:** depends on the InsForge auth backend
capabilities (reset email transport, token issuance) and email provider config
in Railway env. Needs provider dashboard + live email verification.

**Evidence:** `src/pages/Login.tsx:150` renders "Forgot password?" but there is
no server route (`/api/auth/reset-password`, `/api/auth/forgot-password`) and no
reset page. `grep reset-password|forgot|resetPassword server.cjs` → no matches.

**Proposed fix (sketch):**
1. `POST /api/auth/forgot-password { email }` → InsForge SDK reset request;
   rate-limit (e.g. 5/15min/IP+email); always return 200 to prevent enumeration.
2. `POST /api/auth/reset-password { token, new_password }` → verify token, set
   password; argon2id-equivalent via InsForge; expire token on use.
3. New `src/pages/ResetPassword.tsx` route `/reset-password?token=...`; replace
   the dead `Login.tsx:150` link with `href="/forgot-password"`.
**Verify:** request reset for a real user, receive email, set new password, log
in; replay the token → rejected; rate-limit blocks >N requests.

---

## REL-1 (M18) — Emissions summary cache not invalidated on calculator writes  · owner: Engineering  · P2

**Why not auto-applied:** the minimal fix adds an auth-guarded server endpoint
(touches the auth/authorization surface → never-auto-apply).

**Evidence:** the in-app calculator writes directly to Postgres via the
InsForge SDK (`src/components/carbon-calculator/index.tsx:91 .insert([...])`,
`:111 .delete()`), bypassing `server.cjs`. The server's `emissionsSummaryCache`
(5-min TTL, `server.cjs:1283`) is only cleared on CSV ingest (`:1492`) and
facility create (`:1551`). So dashboard `/api/emissions/summary` and `/trend`
serve stale data for up to 5 minutes after a calculator add/delete.

**Proposed fix (smallest):**
```js
// server.cjs — add after the summary route
app.post('/api/emissions/invalidate', apiAuthGuard, async function (req, res) {
  const companyId = await requireCompanyAccess(req, res, req.query.company_id);
  if (!companyId) return;
  for (const key of emissionsSummaryCache.keys()) {
    if (key.startsWith(`summary:${companyId}:`)) emissionsSummaryCache.delete(key);
  }
  return res.json({ success: true });
});
```
Then in `carbon-calculator/index.tsx`, after a successful `.insert()`/`.delete()`:
```ts
await fetch(`/api/emissions/invalidate?company_id=${companyId}`,
  { method: 'POST', ...buildApiRequestInit(insforge) });
```
**Verify:** add a calculator entry, immediately GET `/api/emissions/summary` →
reflects the new entry (no 5-min wait). Regression test: assert cache key gone
after invalidate.

---

## METH-1 (H13) — Scope 2 silently defaults unknown grid regions to California  · owner: Product/Methodology  · P1

**Why not auto-applied:** changes emission-factor methodology (a product +
compliance-relevant decision), not a pure bug fix.

**Evidence:** `emissions-engine.cjs factorForEntry` Scope 2 branch:
`const factor = EGRID_FACTORS[sourceRaw] ?? EGRID_FACTORS.CAMX;` — an unknown
region silently uses the California (CAMX) factor. Also `(1 + TRANSMISSION_LOSS_RATE)`
T&D uplift is always applied, and `amountMultiplier = unit === 'kwh' ? 0.001 : 1`
treats any non-kWh unit as MWh.

**Proposed fix (pending methodology decision):**
- Reject unknown regions: `if (factor == null) throw new Error('Unknown eGRID region: ' + entry.source);`
  (consistent with the per-row isolation now in `summarizeEntries`, so it no
  longer 500s the whole company).
- Decide whether T&D uplift stays (GHG Protocol Scope 2 grid-average typically
  excludes T&D; document either way).
- Reject non-kWh units explicitly rather than assuming MWh.
**Verify:** a row with `source: 'UNKNOWN_REGION'` is reported in `summary.errors`
(not silently CAMX); unit tests cover each branch.

---

## AUTH-2 (M19) — Auth configured without `DATABASE_URL` fails silently  · owner: Engineering/DevOps  · P2

**Why not auto-applied:** touches auth/config failure semantics + needs a
deploy/env decision.

**Evidence:** `server.cjs:49-53` only creates `pgPool` when `DATABASE_URL` is
set. With `INSFORGE_BASE_URL` set but no `DATABASE_URL`, `authGuard` validates
tokens (works) but every data API returns 503/early-return (`/api/trial-status`
`:255`, `/api/billing` `:278`, summary/trend) with only log lines — a signed-in
user sees a broken app with no operator alert.

**Proposed fix:** fail fast at startup if `INSFORGE_BASE_URL && !DATABASE_URL`:
```js
if (INSFORGE_BASE_URL && !process.env.DATABASE_URL) {
  console.error('[FATAL] INSFORGE_BASE_URL is configured but DATABASE_URL is missing — data APIs cannot function.');
  process.exit(1);
}
```
(Or, if mixed mode is intended, return a distinct `503` with an operator-facing
metric/alert on each data API and surface a user-visible "data store unavailable"
state instead of a generic failure.)
**Verify:** boot the server with auth env set and no `DATABASE_URL` → process
exits non-zero with the clear message (or the documented degraded behavior).

---

## LEGAL-1 (P0-02) — Public "business draft for review" banner on all three legal pages  · owner: Legal  · P0 (CRITICAL)

**Why IDE access is insufficient:** the SaaS launch audit skill §3 Phase-4
rules place legal content in the never-auto-apply domain. Removing the draft
banner constitutes declaring the Terms, Privacy Policy, and DPA as
production-reviewed — a legal decision, not an engineering one. The existing
`scripts/check-legal-placeholders.mjs` comment (`§3 Hard Constraints`) intentionally
keeps the banner for exactly this reason.

**Evidence (current code, HEAD `2168f2b`):**
- `src/pages/TermsOfService.tsx:44-46` — amber banner: "This page is provided as a business draft for review and should be reviewed by qualified legal counsel before publication."
- `src/pages/PrivacyPolicy.tsx:51-55` — same banner sentence.
- `src/pages/DataProcessingAddendum.tsx:45-47` — same banner sentence (DPA variant: "...before publication or signature.").

The July 11 UI/UX audit (`ecoauditor-ui-ux-mvp-audit-2026-07-11.md` §5 P0-02)
rates this **Critical**: "Public placeholders signal that the service is not
commercially ready." The placeholder *tokens* (TBD, [Date to be set], etc.)
are already gone — `check-legal-placeholders.mjs` passes. The remaining
defect is the banner sentence itself, which reads as "this is not a real
legal document yet."

**Proposed fix (minimal diff, apply only after counsel sign-off):**
```tsx
// In each of TermsOfService.tsx, PrivacyPolicy.tsx, DataProcessingAddendum.tsx:
// 1. Delete the amber banner block (the <div className="mb-8 p-4 rounded-lg bg-amber-50 ...">…</div>).
// 2. Update "Last updated: June 12, 2026" to the counsel-approved effective date.
// 3. Add a revision-history line at the bottom: "Effective <DATE>. Reviewed by <counsel>. Next review: <DATE>."
```

**Acceptance criteria (from audit P0-02):**
- [ ] No public legal document contains the "business draft for review" sentence.
- [ ] Operator identity (Developer312 / NIGHT LITE USA LLC) is named consistently.
- [ ] Terms match actual Stripe prices, cadence, trial logic, and cancellation behavior (already verified in code; counsel confirms).
- [ ] Privacy language matches actual processors and storage (Annex III lists them).
- [ ] DPA annexes name actual subprocessors (currently generic categories — counsel confirms or names).
- [ ] Legal pages have valid effective and revision dates.
- [ ] A user can save or download the applicable Terms and DPA (print-to-PDF works today).
- [ ] All legal documents remain readable without JavaScript (prerendered HTML confirmed).
- [ ] The site does not claim legal or regulatory compliance beyond what counsel and evidence support.

**Verify after fix:**
```bash
node scripts/check-legal-placeholders.mjs        # still passes (no banned tokens)
npx vitest run tests/legal-placeholders.test.ts # still passes
grep -r "business draft for review" src/pages   # MUST return no matches
npm run build                                   # legal-placeholder gate still green
```

**Risk if shipped without this fix:** the launch verdict stays at
`CONDITIONALLY LAUNCHABLE` — the only remaining Critical UI/UX blocker.
A cautious procurement, finance, or legal buyer evaluating Eco-Auditor for
carbon-accounting will read the banner as "this service is not commercially
ready" and decline to create an account or upload source records.

---

## Notes on items verified FIXED since the 2026-07-06 audit (do not re-flag)

- C2/C3/C4/C5 (CSV persist, auth header, pricing, annual trial) — fixed in PR
  `audit/mvp-fixes-2026-07-06` (merged `35c753d`); re-verified in current code.
- M20 (CSV per-row error collection) — fixed (`server.cjs` per-row try/catch).
- M22 (compliance deadline status) — fixed (`/api/compliance/deadlines` derives
  overdue/due_soon/upcoming from current date, `server.cjs:1587`).
- M14 (session re-validation + 401 handling) — fixed (`src/lib/session.ts` 401
  fetch wrapper; Login/Signup `checkSession`).
- M33 (per-route canonical) — fixed THIS session in `scripts/prerender.mjs`.
- H21 (per-row fault isolation) — fixed THIS session in `emissions-engine.cjs`.
- H5 (trend 12 months + year filter) — fixed THIS session (`buildTrend`).
- M15 (CSV-only file picker) — fixed THIS session (`DataIntake.tsx`).
