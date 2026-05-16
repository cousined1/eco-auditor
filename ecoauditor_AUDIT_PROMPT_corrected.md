# MVP Audit — EcoAuditor.io

**Approved by:** Javante (CTO)
**Date:** 2026-05-13
**Scope:** Comprehensive MVP audit of EcoAuditor.io — GHG carbon accounting SaaS for SMBs
**Stack:** Vite + React + TypeScript frontend, Express server (server.cjs), InsForge SDK for auth, Drizzle Kit for schema/migrations, Stripe for billing, Railway hosting

---

## Stack Reality (verified by live codebase inspection)

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Frontend** | Vite + React 19 + TypeScript | SPA with react-router-dom, `build.outDir: 'static'` |
| **Backend** | Express server (`server.cjs`) | 14 routes: health, version, Stripe billing, chatbot, leads, video |
| **Auth** | InsForge SDK (`@insforge/sdk`) | `createClient` in `src/lib/insforge.ts`, used by ContactUs page |
| **Database** | InsForge-hosted Postgres + local `db` | Drizzle Kit for schema/migrations; runtime queries use Drizzle ORM (`src/db/index.ts`) NOT InsForge PostgREST |
| **Migrations** | Drizzle Kit (`drizzle.config.ts`) | `db:push`, `db:generate`, `db:migrate` scripts in package.json |
| **Billing** | Stripe (live integration) | Checkout, portal, subscription, webhook in `server.cjs`; client-side in `src/lib/stripe.ts` |
| **Testing** | Vitest (`vitest.config.ts`) | Tests in `tests/` — insforge, stripe, mockData, server |
| **Hosting** | Railway (Nixpacks) | `railway.toml`, `nixpacks.toml`, `Procfile` |

**Env prefix:** `VITE_*` (Vite convention), plus `STRIPE_*` and `DATABASE_URL` for server-side

**Critical corrections from earlier drafts:**
1. Express server.cjs EXISTS — 14 API routes, including billing, chatbot, leads
2. Stripe IS wired — full checkout + portal + webhook flow
3. Drizzle ORM IS used at runtime (`src/db/index.ts` creates pool + ORM instance)
4. InsForge SDK is used for auth only (ContactUs form), NOT for runtime CRUD

---

## PHASE 0 — RECON & AMBIGUITY RESOLUTION

Resolve these unknowns BEFORE starting any audit work. Do not proceed to Phase 1 until all are answered.

| # | Unknown | How to resolve | Exit criterion |
|---|---------|---------------|----------------|
| 0.1 | Env-var prefix | Read `.env.example`, `vite.config.ts` | Confirm `VITE_INSFORGE_BASE_URL`, `VITE_INSFORGE_ANON_KEY`, `DATABASE_URL`, `STRIPE_SECRET_KEY` |
| 0.2 | Migration tooling | Read `drizzle.config.ts`, check `migrations/` or `drizzle/` dir | Confirm Drizzle Kit is canonical; report if `.sql` files exist |
| 0.3 | Table names | Read `src/db/schema.ts` | List all tables: companies, facilities, emission_entries, ledger_entries, uploaded_files, suppliers, reports, compliance_tasks, missing_data_alerts, contact_submissions, trend_data |
| 0.4 | Emission factors source | Grep `src/` for hardcoded factors vs. database lookup | Report: mockData.ts has mock data; real factors may be hardcoded or from EPA source |
| 0.5 | Test infrastructure | Check `tests/` dir, `vitest.config.ts` | Report framework (Vitest confirmed) and coverage |
| 0.6 | Server routes | Read `server.cjs` fully, list all `app.(get|post|put|delete|patch)` | Inventory of 14 routes with auth requirements |
| 0.7 | Stripe env vars | Check Railway dashboard or `.env` for `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VITE_STRIPE_PK` | Report presence only, never values |
| 0.8 | InsForge runtime usage | Grep `src/` for `insforge.database`, `insforge.auth`, `insforge.storage` | Currently only used in ContactUs.tsx for form submission |

---

## PHASE 1 — LAST COMMIT AUDIT

Run:
```bash
git log -1 --stat
git diff HEAD~1 HEAD
```

For every file changed:
- Identify purpose (feat/fix/refactor/chore)
- Check syntax errors, missing imports, broken references
- **Flag hardcoded credentials** — grep for `sk_`, `pk_`, `INSFORGE_KEY=`, `password`, `.env` values committed directly. **Zero matches required.**
- Check for missing `.error` handling on async calls
- Flag `: any`, `as any`, `@ts-ignore`, `@ts-expect-error`
- Verify schema changes have matching migration in `migrations/` or `drizzle/`
- Run `npx tsc --noEmit` — exit 0 is Gate 1

| Slice | Action | Pass criterion |
|-------|--------|---------------|
| 1.1 | `git log -1 --stat` + `git diff HEAD~1 HEAD` | Non-empty diff, parseable |
| 1.2 | Classify each changed file | Structured row per file |
| 1.3 | Grep diff for secrets (`sk_`, `pk_`, passwords, `.env` literals) | Zero matches |
| 1.4 | Grep diff for unchecked async calls | Zero missing error handling |
| 1.5 | Grep diff for `: any`, `as any`, `@ts-ignore` | Flag each occurrence |
| 1.6 | Cross-check TS schema changes against `drizzle/` or `migrations/` | Migration exists or finding logged |
| 1.7 | `npx tsc --noEmit` | Exit 0 (Gate 1) |
| 1.8 | Read `server.cjs` changes | Flag new routes, missing auth guards, raw body parsing issues |

Deliverable:
```
[FILE] → [CHANGE TYPE] → [RISK: LOW/MED/HIGH] → [NOTES]
```

---

## PHASE 2 — DATABASE HEALTH CHECK

Tool: Drizzle Kit CLI + direct DB probes (NOT Prisma, NOT raw SQL unless needed)

| Slice | Probe | Pass criterion | Escalate to HITL if |
|-------|-------|---------------|---------------------|
| 2.1 | Env presence: `.env` / `.env.local` has `DATABASE_URL`, `VITE_INSFORGE_BASE_URL`, `VITE_INSFORGE_ANON_KEY` | All present (report presence only) | Keys missing |
| 2.2 | Schema enumeration: `npx drizzle-kit introspect` or query `information_schema.tables` | All 11 tables from schema.ts exist | CLI fails or table missing |
| 2.3 | Migration status: Check `drizzle/` dir for migration files; compare to schema.ts | Schema and migrations in sync | Drift detected |
| 2.4 | Auth probe (InsForge): `insforge.auth.signUp()` → `signInWithPassword()` → `getUser()` → `signOut()` | Session token returned; final `getUser` null | Auth endpoint unreachable |
| 2.5 | Drizzle connection: `src/db/index.ts` creates pool with `DATABASE_URL`; test `db.select().from(schema.companies).limit(1)` | Returns without error | Connection fails |
| 2.6 | Emission entries probe: Insert Scope 1 entry → re-fetch → assert `amount * factor ≈ computed CO2e` within ±0.01 | Math passes | Calculation wrong |
| 2.7 | Seed data: Run `npm run db:seed` (script: `tsx src/data/seed.ts`) | Completes without error, tables populated | Seed fails |
| 2.8 | RLS probe (if InsForge tables have RLS): Sign in as User B, attempt to read User A's `contact_submissions` | Empty result or 403 | Cross-tenant data leak → P0 |
| 2.9 | Cleanup: Re-query all test IDs; assert 0 rows remain | Zero residue | — |

Deliverable:
```
[TABLE] → [CRUD STATUS] → [ERROR] → [INTEGRITY NOTES]
```
Plus RLS verdict: **SECURE / INSECURE / UNABLE TO VERIFY**

---

## PHASE 3 — MVP FEATURE VERIFICATION

Verify end-to-end (schema → runtime → UI), not layer-by-layer.

| Slice | End-to-end probe | Pass criterion |
|-------|-----------------|---------------|
| 3.1 | Auth flow: signUp → signIn → protected route (`/app`) → signOut | Session round-trip works; `/app` redirects when unauthed |
| 3.2 | Company onboarding: Create company via seed or UI; verify `companies` table linkage | Row exists with correct FKs |
| 3.3 | Data Intake: Upload file → mock processing → approval → ledger entry | UI state updates; `handleApprove` is mock (OK for MVP) |
| 3.4 | Dashboard: Load `/app` with seed data; verify charts render, no NaN/undefined | Recharts renders; metrics display correctly |
| 3.5 | Reports: Navigate to `/app/reports`; verify report list renders | No blank cards, no console errors |
| 3.6 | Contact form: Submit via ContactUs → write to `contact_submissions` table | Row inserted; no error |
| 3.7 | Stripe checkout: Click pricing CTA → `/api/checkout` → Stripe session URL | Returns `{ url: "..." }` or 503 if Stripe not configured |
| 3.8 | Empty state: New user with zero entries → dashboard load | Renders without errors; shows onboarding or zero-state |
| 3.9 | Salesbot chat: Open chat widget → send message → bot responds | Response received; lead written to `.data/leads.json` |

Tooling preference:
1. Extend existing tests in `tests/`
2. SDK probe script (`scripts/audit-probe.ts` via `tsx`)
3. Playwright for UI assertions (3.4, 3.8) — only if not covered by 1 or 2

Deliverable: Feature-by-feature **PASS/FAIL** with response shape evidence.

---

## PHASE 4 — MVP READINESS CHECKLIST

| Section | Checks |
|---------|--------|
| Env & config | `.env.example` present? `DATABASE_URL` and Stripe keys NOT committed? `git log --all -S "sk_live"` — report filenames only, never values |
| SDK integration | Single `createClient` export in `src/lib/insforge.ts`; `.error` handling on SDK calls; `onAuthStateChange` present? |
| Code quality | `tsc --noEmit` clean; `console.log` count in `src/` (exclude tests); hardcoded UUID/factor grep |
| Data integrity | `schema.ts` has `NOT NULL` on required fields; FK `onDelete` set (cascade or restrict); enums defined |
| Security | `server.cjs` rate limiting present? Stripe webhook signature verification? `/api/chat` and `/api/leads` have auth? `npm audit --omit=dev` HIGH/CRITICAL count = 0 (Gate 3) |
| UI/UX | `npm run build` exit 0; empty-state component exists; form validation messages present |
| Server health | `/health` and `/ready` endpoints respond 200; `/api/version` returns version string |

Deliverable:
```
[ITEM] → [PASS / FAIL / NEEDS ATTENTION] → [EVIDENCE]
```

---

## PHASE 5 — SERVER.CJS SECURITY AUDIT (NEW)

This is critical and was missing from prior drafts.

| Slice | Probe | Pass criterion | Risk |
|-------|-------|---------------|------|
| 5.1 | Route inventory | List all 14 routes with HTTP methods | Missing route = missing feature |
| 5.2 | Auth guards | `/api/subscription`, `/api/checkout`, `/api/portal` require what auth? | Unauthenticated billing access = P1 |
| 5.3 | Stripe webhook | Signature verification uses `STRIPE_WEBHOOK_SECRET`? | Missing sig verify = payment fraud risk |
| 5.4 | Chatbot (`/api/chat`) | No auth required — is this intentional? DDoS risk? | Public endpoint with no rate limit = P2 |
| 5.5 | Leads (`/api/leads`) | Writes to `.data/leads.json` — not InsForge DB | Data not in main DB = backup/DR risk |
| 5.6 | Video (`/api/video`) | Serves `eco-auditor-intro.mp4` from filesystem | Path traversal risk? |
| 5.7 | Rate limiting | In-memory Map per IP, 120 req/min | DDoS protection exists but not distributed |
| 5.8 | Error handling | All routes have try/catch, no unhandled rejections | Server crash risk |

---

## FINAL VERDICT

One of:
- **READY** — all gates pass, no P1 findings
- **NEEDS FIXES** — P1/P2 findings that must be addressed before launch
- **BLOCKED** — fundamental issue prevents completion (e.g., no DB connectivity, Stripe webhook broken)

Prioritized fix list:
- **P1** (blocks launch)
- **P2** (important, non-blocking)
- **P3** (polish)

Compound learning note: One paragraph at report tail — what this audit revealed that should change the next development cycle.

---

## OUT OF SCOPE

- Performance profiling, load testing
- E2E browser visual regression beyond empty-state and dashboard render
- Refactoring or fixing findings — this audit reports only; remediation is a follow-up
- **Note:** Stripe billing IS in scope (it's live). If you want to defer billing security audit, explicitly flag as "KNOWN GAP" rather than "not wired."

---

## REPORT DESTINATION

Write consolidated report to `AUDIT_REPORT.md` (overwrite existing). Preserve prior important findings in an appendix before overwriting.

---

## OPEN QUESTIONS FOR HUMAN (Edward)

1. **Permission to run live probes:** The audit will create test users and rows in the live InsForge instance + local DB, then clean them up. Confirm OK to proceed.
2. **RLS policies:** Are Row Level Security policies configured on InsForge tables, or should absence be flagged as a finding?
3. **Server.cjs auth:** Should `/api/chat` and `/api/leads` require any authentication, or are they intentionally public?
4. **Stripe mode:** Is Stripe in test mode or live mode? Should the audit create real test checkout sessions?

**Execute Phase 0 recon immediately. Proceed to Phase 1+ only after confirmation.**
