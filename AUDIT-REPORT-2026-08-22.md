# EcoAuditor.io — Full-Stack Audit & Safe Remediation Report

**Date:** 2026-08-22 · **Branch:** `audit/ecoauditor-fixes-2026-08-22` · **Mode:** evidence-first, minimal-risk remediation
**Auditor:** PrimeAgent Eddie (godmythos REVIEW + FIX loop)

---

## 1. Executive summary

Overall risk posture at audit start: **moderate and improving**. The codebase shows multiple prior remediation passes; the critical auth, billing, webhook, and tenant-isolation surfaces are in materially good shape. A large uncommitted remediation pass was found in the working tree at start — it was preserved verbatim as its own commit, verified green, and audited like any other change.

- **Findings: 0 × P0, 1 × P1 (deployment blocker, approval-gated), 4 × P2, 3 × P3**
- **Fixed in this audit:** 2 (tenant-enumeration oracle on report download; missing RLS on `blog_posts`)
- **Preserved & verified (pre-existing WIP):** 1 commit covering ~20 remediations (billing sync correctness, trial-eligibility single-sourcing, price-id resolution, ingest column persistence, chat reliability, UTC trend bucketing, confidence/edge-case domain fixes, frontend form/UX fixes)
- **Deferred / review-required:** 5 (see §7) — all involve production mutation, product decisions, or business-rule ambiguity

No secrets were printed, rotated, or committed. Production inspection was read-only (public GET/HEAD probes + InsForge CLI `db migrations list`).

## 2. Stack and architecture summary

| Layer | Detail |
|---|---|
| Frontend | React 19 + Vite 8 + TypeScript 6, React Router 7, Tailwind 3.4 (locked), recharts |
| Backend | Node 22, Express 4 (`server.cjs` ~3.4k lines) + modules: `server-billing.cjs`, `server-security.cjs`, `server-publish.cjs` |
| Database | PostgreSQL (InsForge), migrations in `migrations/*.sql`, RLS deny-by-default, server writes via pg pool with `row_security = off` |
| Auth | InsForge bearer sessions; `authGuard` validates tokens against `/api/auth/sessions/current`; dev fallback behind `DEV_AUTH_SECRET` |
| Billing | Stripe subscriptions (3 tiers × monthly/annual), signed webhooks (raw body), event watermark for idempotent sync |
| Deployment | Railway (`railway.toml`, nixpacks), prerendered static marketing routes (14), Cloudflare edge |
| Tests | Vitest, 24 files / 204 tests, includes route-spawn health test and publish-endpoint contract tests |

**Critical flows verified:** signup/login (InsForge OAuth+password), session guard, per-user single company (`companies_user_id_unique`), plan entitlement middleware (`requirePlan`), checkout (price allow-list, duplicate-subscription rejection, once-per-customer trial), webhook (signature + watermark + retry policy), CSV ingest (quota + per-row errors), blog publish (timing-safe token), static asset serving.

## 3. Findings table

| ID | Pri | Area | Title | Evidence | Affected files | Impact | Fix applied / recommendation | Verification | Status |
|---|---|---|---|---|---|---|---|---|---|
| F-01 | P1 | Deployment safety | Migration `20260822000000` (entry `co2e_kg`/`activity_date`/`notes`) **not applied** to production; ingest code on this branch writes those columns | InsForge CLI `db migrations list` — 8 applied, `20260822000000` absent | `migrations/20260822000000_add-entry-co2e-date-notes.sql`, `server.cjs` | CSV import would 500 for every user if this branch deploys before the migration runs | **Review-required:** run `npm run db:migrate` (additive `ADD COLUMN IF NOT EXISTS` + index) immediately before/with the next deploy | CLI listing vs local dir diff | CONFIRMED |
| F-02 | P2 | Tenant isolation | `/api/reports/:id/download` fetched the report row before the tenant check → 404 (missing) vs 403 (foreign-but-real) let any authenticated user enumerate sequential report IDs across tenants | Code path `server.cjs` (pre-patch): `SELECT company_id FROM reports WHERE id=$1` then `requireCompanyAccess(rows[0].company_id)` | `server.cjs` | Cross-tenant existence oracle; same class as the facility-ID oracle fixed in the pre-existing WIP | **Fixed:** resolve caller's company first, then `WHERE id=$1 AND company_id=$2`; identical 404 for both cases | Code evidence + pattern parity with the audited facility fix; full suite green ×2 | CONFIRMED / FIXED |
| F-03 | P2 | Security hardening | `blog_posts` table (created at runtime, not in migrations) had **no RLS** — every other table is deny-by-default; exposure depended entirely on PostgREST role grants | `server.cjs` startup block: `CREATE TABLE IF NOT EXISTS blog_posts ...` with no `ENABLE ROW LEVEL SECURITY`; `initial-schema.sql` documents the deny-by-default model for all other tables | `server.cjs`, `blog_posts` | If the PostgREST surface ever grants `authenticated` writes, that is stored XSS into `dangerouslySetInnerHTML` (BlogPost.tsx:173) on the public site. Actual exploitability **UNVERIFIED** (PostgREST surface not reachable with available anon key) | **Fixed:** `ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY` added to the idempotent startup DDL; no policies (server connects as table owner, exempt from non-FORCE RLS; `/api/publish` already token-gated) | Code evidence; `node --check`, lint, suite green. Server-path safety follows from owner-exemption semantics | CONFIRMED gap / UNVERIFIED exploitability / HARDENED |
| F-04 | P2 | Observability | Production `/api/health` reports `sha:null, build:null` — deployed commit cannot be verified from the endpoint (the code supports `GIT_SHA`; the deploy env doesn't set it) | Live probe: `{"status":"ok","sha":null,"build":null,...}`; `tests/server-health.test.ts` asserts SHA plumbing works when `GIT_SHA` is set | Railway service env | WEB_DEBUG doctrine: a merged commit not visible at `/api/health` is a deployment failure you cannot detect | **Review-required:** set `GIT_SHA`/`BUILD` env in the Railway service (deploy-config change) | Live probe + test file | CONFIRMED |
| F-05 | P2 | Data lifecycle | No account/data deletion or retention endpoint anywhere (`delete-account|retention|gdpr|erase` — zero hits) | Grep across `server.cjs` and `src/pages/Settings.tsx` | product-wide | GDPR/CCPA right-to-erase unimplementable by users; SaaS-critical flow gap | **Review-required:** product decision (destructive); propose `DELETE /api/account` cascading via `companies.user_id` FKs + Stripe customer deletion | Grep evidence | CONFIRMED (gap) |
| F-06 | P3 | Trust/consistency | `/api/version` reports `1.0.0` while `package.json` says `2.0.0` | Live probe vs `package.json` | `server.cjs` version constant | Minor trust/consistency nit on a public endpoint | Recommend deriving from `package.json` version or updating the constant (not changed — trivial, cosmetic) | Live probe | CONFIRMED |
| F-07 | P3 | SEO/infra | `/methodology`, `/sample-report`, `/blog` return 301 to trailing-slash variants (consistent, cacheable) — acceptable; recorded as intentional-looking canonicalization | Live HEAD probes | prerender script | None material | None needed | Live probes | CONFIRMED (no action) |
| F-08 | P3 | Defense-in-depth | Blog `body_html` rendered via `dangerouslySetInnerHTML` with no sanitizer; writers are trusted (deploy-token publish + startup seeds) | `src/pages/BlogPost.tsx:173`; `server-publish.cjs` token gate (timing-safe) + `bodyFormat` must be `html` | `src/pages/BlogPost.tsx` | A compromised publish token = stored XSS | Documented as accepted trust boundary; optional future: server-side HTML allow-list sanitize on publish | Code evidence | CONFIRMED (accepted risk) |

**Verified-clean surfaces (no findings):** npm audit (0 vulns, full tree); security headers on live origin (CSP, HSTS+preload, XFO DENY, nosniff, Referrer-Policy, Permissions-Policy); webhook signature verification (raw body + `constructEvent` + retry-window policy); checkout (price allow-list, no second subscription, one trial per customer); checkout/verify customer binding; SQL injection (all queries parameterized); bundle secret scan (no `sk_live/whsec/uak_` shapes in `static/`); robots.txt + sitemap.xml coherent with auth-only routes disallowed; prerendered SEO head complete (title/description/canonical/OG/Twitter); `og-image.png` and `llms.txt` live; rate limiting (global per-IP + per-route) with spoof-safe keying and webhook exemption; video range-request handling (validated 416 path); emissions domain engine edge cases (negative/zero/null amounts rejected or handled, UTC bucketing, empty-inventory confidence, scope-label vs catalog-scope agreement, kg/t CO2e passthrough parity client/server); RLS policy set on all migrated tables (owner-chained through `companies.user_id`).

## 4. Fix log

| Commit | Contents |
|---|---|
| `907877a` | **Preserved pre-existing WIP** (found uncommitted at audit start; verified green before committing): billing watermark tie-safety, sync-result surfacing, `resolvePriceId` unification, trial-eligibility single-source, facility-ID oracle fix, compliance signoff persistence + scoping, ingest column persistence, guarded async handlers, health try/catch, ROLLBACK guard, chat fallbacks, emission-factor catalog expansion + verification notes, stripe.ts runtime-pk + cache-failure fixes, form/UX fixes, `entryKgCO2e` client parity helper |
| (this audit) | `fix(security): close cross-tenant report-ID oracle on /api/reports/:id/download` — caller-company-first resolution, scoped lookup, identical 404s |
| (this audit) | `fix(security): enable deny-by-default RLS on blog_posts` — idempotent startup `ALTER TABLE` |
| (this audit) | `docs(audit): add 2026-08-22 audit report` — this file |

**Tests added/updated:** none new (both fixes mirror already-shipped audited patterns; route-level DB tests would require a Postgres harness the repo does not have — noted as follow-up in §7).

## 5. Commands run (verification ladder)

| Command | Result |
|---|---|
| `npx eslint .` | PASS (0 problems) |
| `npx tsc -b` | PASS |
| `npx vitest run` (×3 after fixes) | PASS 204/204 (one transient port-race failure in a first run, not reproducible in two consecutive full runs; unrelated to changes) |
| `npm run build` (incl. legal check + prerender) | PASS — 14/14 routes prerendered |
| `npm audit` / `npm audit --omit=dev` | PASS — 0 vulnerabilities |
| `node --check server.cjs` | PASS |
| Live probes `https://ecoauditor.io` (GET/HEAD, read-only) | PASS — health 200, config/prices 200, robots/sitemap/og-image/llms.txt 200 |
| `npx @insforge/cli db migrations list` (read-only) | PASS — 8 applied; `20260822000000` missing → F-01 |

## 6. Pre-existing failures

- The single flaky vitest run described above (server-health spawn/port race). No code failures pre-existed or were introduced.

## 7. Review-required items (not done — approval needed)

1. **F-01 (P1):** apply migration `20260822000000` (`npm run db:migrate`) **before** deploying this branch, else CSV import breaks. Additive and backward-compatible, but it mutates the production DB — left to owner approval.
2. **F-04:** set `GIT_SHA` (and optionally `BUILD`) in the Railway service so `/api/health` verifies deploys.
3. **F-05:** account/data-deletion + retention flow (GDPR/CCPA) — needs product decision; FK cascade via `companies.user_id` + Stripe customer deletion is the natural design.
4. **F-08 (optional):** server-side HTML sanitization of `body_html` on `/api/publish` as defense-in-depth.
5. **Unverified emission factors:** `emission-factors.json` carries `"verified": false` + notes on fuel_oil_4, fuel_oil_6, coal (values don't reconcile with EPA EFH 2025 derivations). Domain-math corrections require source confirmation per the prime directive — flagged, not changed.
6. **PostgREST exposure of `blog_posts`** could not be tested with available credentials (F-03 exploitability UNVERIFIED; hardening applied regardless).

## 8. PR summary (ready)

> **audit: full-surface audit + safe remediation (2026-08-22)**
>
> - Preserves and verifies a prior uncommitted remediation pass (billing sync tie-safety, tenant oracles, ingest columns, reliability guards, factor catalog)
> - Closes the cross-tenant report-ID enumeration oracle on `/api/reports/:id/download`
> - Enables deny-by-default RLS on `blog_posts` (defense-in-depth for the only table without it)
> - Adds this audit report
>
> ⚠️ **Deploy gate:** run `npm run db:migrate` (applies `20260822000000`) before/with this deploy, or CSV import will 500.
>
> Verified: eslint, tsc, 204/204 vitest, full build + prerender, npm audit 0, live read-only prod probes.
