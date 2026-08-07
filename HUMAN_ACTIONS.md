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

> **RESOLVED 2026-07-29 (Strix SARIF pass).** The proposed fail-fast below was
> implemented in `server.cjs` (`startServer()`), and extended to also probe an
> unreachable `DATABASE_URL`, not just a missing one. Verified: production boot
> exits 1 for both missing and unreachable DB. Retained for history. The
> operational half — actually setting a reachable value — is **OPS-1** below.

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

# Strix SARIF remediation (2026-07-29) — production-only actions

Source: `findings.sarif` (Strix, 2026-07-29). The code-side fixes for all five
findings were applied this session and verified (171/171 tests, build green,
`npm run security:audit` green, gitleaks green + negative-control). The four
items below **cannot** be closed from the IDE — they need Railway/provider
access or a coordinated force-push — and each is a precondition for the
production outage actually ending.

Run them in order: **OPS-1 first** (it is the live outage), then SEC-2/SEC-3.

---

## OPS-1 — `DATABASE_URL` outage: NOT REPRODUCIBLE as of 2026-07-29 · owner: DevOps · P2 (was P0)

> **STATUS CORRECTION (2026-07-29, re-verified against live production).**
> The SARIF report describes a total outage. **Live production does not show
> it.** Re-probing `https://ecoauditor.io` at deployed sha `2521553` (identical
> to the sha this remediation was authored against):
> ```
> GET /api/health      → 200  {"status":"ok","db":"configured","sha":"2521553…"}
> GET /api/blog-posts  → 200  4 posts served FROM POSTGRES via the same pgPool
> ```
> `/api/blog-posts` is the decisive signal: it executes
> `SELECT … FROM blog_posts` on the very pool the SARIF finding claims is
> unreachable. Rows come back. **`DATABASE_URL` is set and the database is
> reachable.** Operator confirms the variable is present in Railway.
>
> The SARIF finding was either fixed by an intervening deploy, or was recorded
> against a different environment. Do **not** treat this as a live P0.
> Nothing here needs an emergency change.
>
> One caveat worth noting: the *reason* `db:"configured"` looked reassuring
> during the outage report is the exact defect this PR fixes — the old health
> route reported env-var presence, never connectivity. After this PR merges,
> that field becomes `db:"ok"` from a real `SELECT 1`, so a future outage will
> be visible instead of silently green. Until then, `db:"configured"` alone is
> **not** proof of connectivity — `/api/blog-posts` returning rows is.

**Why IDE access is insufficient:** the defect described was a Railway service
variable, not code.

**Original SARIF evidence (NOT reproducible today — retained for audit
history):** `findings.sarif` vuln-0001 (CVSS 7.5) reported dynamic testing with
two verified accounts where `/api/emissions/summary`, `/api/emissions/trend`,
`/api/companies/:id/facilities`, `/api/ingest/csv`, `/api/calculate`,
`/api/compliance`, `/api/reports/*` all returned `{"success":false,
"error":"Forbidden"}`; `/api/trial-status` → `"source":"error-fallback"`;
`/api/billing` → 500.

**Applied this session (code side):** `server.cjs` now (a) live-probes the DB in
`healthPayload()` with a 3s timeout and reports `db:"ok"|"unreachable"` instead
of echoing env presence, (b) returns 503 `degraded` from `/health` and
`/api/health` when the DB is configured but unreachable, (c) returns 503
`Data store unavailable` rather than 403 when company provisioning fails, and
(d) refuses to boot in production when the DB is missing or unreachable.

> **DEPLOY CAUTION — read before redeploying.** Item (d) changes failure mode:
> with a still-broken `DATABASE_URL` the service will now **exit non-zero at
> startup instead of serving a degraded app**. Set the variable *before* or *in
> the same deploy as* this change, or the service will fail to come up.

**Action (reduced — the emergency step is already satisfied):**
1. ~~Set `DATABASE_URL` in Railway~~ — already set; connectivity verified.
2. On the next deploy of this PR, confirm the health field flips from
   `db:"configured"` to `db:"ok"` (proves the live probe is active).

**Verify (all three must pass):**
```bash
curl -sS "$APP_URL/api/health" | jq '{status, db, sha}'   # status "ok", db "ok"
# sha MUST equal the commit you intended to deploy — a mismatch is a deploy failure, not an app bug
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" "$APP_URL/api/emissions/summary"
# expect 200 (entitled) or 402 (upgrade_required) — 403 means this item is NOT fixed
```

**Follow-up:** add a synthetic check that exercises one authenticated data
endpoint and alerts on a 403 spike; `/api/health` alone would not have caught
this outage before the probe change.

---

## SEC-2 — Rotate the two committed API keys · owner: Security · P1

**Why IDE access is insufficient:** revocation happens in provider dashboards.

**Exactly which two keys (verified by git archaeology 2026-07-29):**

| # | Key | Provider | Where it leaked | Commits | In HEAD? |
|---|-----|----------|-----------------|---------|----------|
| 1 | `ik_sehr…` (InsForge API key) | InsForge | `opencode.json` | `f2eaf94` (added), `cc62540` (redacted) | No — now `${INSFORGE_MCP_API_KEY}` |
| 2 | `8eba…` (Ollama API key) | Ollama | `.env.ollama` | `edfa108` (added), `cb801b4`, `dfdb256` | No — file absent from HEAD |

**It is NOT the Stripe key.** A reasonable hypothesis was that
`STRIPE_SECRET_KEY` leaked. Checked and **ruled out**:
`git log --all -S 'sk_live'` returns 4 commits, but every hit is a
documentation placeholder — `sk_live_...` in `ADR.md`/`DEPLOY.md`, and
`sk_live_your_secret_key` in `railway.env.example`. No live Stripe secret is
in history. Stripe is correctly read from `process.env.STRIPE_SECRET_KEY`
(`server.cjs`). No Stripe rotation is required for this finding.

**Evidence:** `findings.sarif` vuln-0003 (CVSS 5.3).

Strix reports both backends currently reject the keys (404 / 401 invalid).
That limits present-day exploitability — it does **not** remove the need to
rotate, since a restored backend or any key reuse re-arms them.

**Action:** revoke + regenerate both credentials in the InsForge dashboard and
the Ollama provider console. Audit InsForge access logs for prior use.

**Verify:** old key returns 401/403 from its provider; the app still functions
with the regenerated value supplied via environment.

---

## SEC-3 — Purge `.env.ollama` from git history · owner: Engineering · P1

**Why IDE access is insufficient:** requires history rewrite + force-push +
coordinated re-clone by every contributor. Destructive and irreversible.

**Evidence:** `findings.sarif` vuln-0003; commit `edfa108`
("config: add ollama api key for openensemble integration").

**Do SEC-2 first.** Rotation is what actually neutralizes the key; the purge
only limits further spread. A purge without rotation leaves a live credential
in every existing clone.

**Action:**
```bash
git clone --mirror <remote> eco-auditor-purge && cd eco-auditor-purge
git filter-repo --path .env.ollama --invert-paths   # or BFG --delete-files .env.ollama
git push --force --all && git push --force --tags
```
Then require every contributor to re-clone; existing clones still contain the
blob.

**Verify:** `git log --all --full-history -- .env.ollama` returns nothing in a
fresh clone.

---

## SEC-4 — Decide on the React Router audit exception · owner: Engineering · P2

**Why this needs a human:** it is a risk-acceptance decision, not a fix.

**Context:** dependencies were upgraded this session (react-router-dom 7.18.2,
postcss 8.5.24, ws 8.21.1, body-parser 1.20.6, esbuild 0.28.1). One advisory
remains open with no v7 fix: **GHSA-qwww-vcr4-c8h2** (high, RSC-mode CSRF),
patched only in react-router 8.3.0.

**Assessment:** this app is a client-only Vite SPA using declarative
`<BrowserRouter>`; it does not use the unstable RSC server-action path the
advisory affects. Rather than force a v8 major migration to silence a
non-applicable finding, `scripts/audit-production.mjs` encodes this **single**
documented exception by advisory URL and still fails the build on every other
high/critical production advisory.

**Action:** either (a) ratify the exception, or (b) schedule the v8 migration.
If v8 is adopted, delete the `allowedAdvisories` entry in
`scripts/audit-production.mjs` — it should not outlive its justification.

**Verify:** `npm run security:audit` exits 0; planting any other high advisory
makes it exit 1.

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
