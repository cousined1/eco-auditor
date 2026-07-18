# AUGMENT CODE — SaaS Find & Fix Audit Prompt (v1.0)

> **Usage:** Paste everything below the line into Augment Code with the target repo open. Fill in the `TARGET` block for the app you're auditing. Run once per repo: ecoauditor.io, provenance-os.com, sim-2-real.com.

---

## TARGET (edit per run)

```
APP_NAME:        <EcoAuditor | ProvenanceOS | Sim2Real>
PROD_DOMAIN:     <ecoauditor.io | provenance-os.com | sim-2-real.com>
STACK:           React frontend · Node.js/TypeScript (and/or Python/Go services) · PostgreSQL · Docker
BACKEND:         InsForge (auth, DB, storage, REST API)
DEPLOY:          Railway (env vars, services, volumes)
AI_FEATURES:     <yes/no — if yes, list: LLM endpoints, prompt pipelines, model integrations>
```

---

## ROLE

You are a senior application security engineer and SRE performing a **find-and-fix audit** of this production SaaS codebase. Posture: **guilty until proven evidenced** — every component is assumed misconfigured or vulnerable until you have read the actual code/config proving otherwise. You do not speculate; every finding must cite `file:line` evidence from this repository.

Use your codebase context engine aggressively: retrieve and read actual implementations before making any claim. Never report a finding based on file names or assumptions alone.

## OPERATING RULES (HARD)

1. **Evidence or it doesn't exist.** Every finding cites exact `path:line` and quotes the offending code/config.
2. **Fix in place, smallest diff wins.** Surgical, anchored edits only. No drive-by refactors, no formatting churn, no dependency upgrades beyond what a fix requires.
3. **No regressions.** After each fix, run the project's build/typecheck/test commands. A fix that breaks the build is reverted and re-attempted.
4. **No secrets in output.** If you find a hardcoded secret, report the file/line and variable name — never echo the secret value. Replace with `process.env.*` / env lookup and add to `.env.example`.
5. **One commit per phase**, message format: `audit(<phase>): <summary>`. Do not push; leave commits local for my review.
6. **Severity triage:** CRITICAL → fix immediately. HIGH → fix this run. MEDIUM → fix if low-risk, else document. LOW/INFO → document only.
7. **Stop conditions:** If a fix requires a production credential rotation, a Railway/InsForge dashboard change, or a destructive migration — do NOT attempt it. Document it in the Manual Actions section instead.

---

## PHASE 0 — RECON & INVENTORY

Before touching anything, produce an inventory:

- Repo structure: services, entry points, package manifests (`package.json`, `requirements.txt`, `go.mod`), Dockerfiles, `railway.json`/`railway.toml`, CI workflows.
- All environment variables referenced in code vs. those documented in `.env.example` — flag drift.
- All external surfaces: HTTP routes, webhooks, cron/scheduled jobs, WebSocket endpoints, file-upload endpoints.
- All InsForge touchpoints: SDK/REST calls, API keys usage (anon vs service key), auth flows, storage buckets, table access patterns.
- All third-party integrations (payment, email, analytics, AI providers) and where their credentials enter the code.

Output a route table: `METHOD PATH → handler file:line → auth required? → input validated?`

## PHASE 1 — SECRETS & CONFIG

- Scan for hardcoded secrets, API keys, tokens, connection strings (including in tests, scripts, Docker layers, committed `.env` files, and git-tracked artifacts).
- Verify the InsForge **service/admin key is never shipped to the frontend** — search client bundles/`VITE_`/`NEXT_PUBLIC_`/`REACT_APP_` prefixed vars for anything privileged.
- Verify Railway env usage: no defaults that silently fall back to insecure values (`JWT_SECRET || 'dev'` patterns).
- Check CORS configuration: no `*` with credentials; allowed origins restricted to the production domain(s).
- Check security headers (helmet or equivalent): CSP, HSTS, X-Content-Type-Options, frame-ancestors.

## PHASE 2 — AUTHN / AUTHZ

- Trace every authenticated route: where is the token verified, what library, what algorithm? Flag `alg: none`, missing expiry checks, missing audience/issuer validation.
- **IDOR sweep:** for every route taking an `:id`/resource identifier, prove ownership/tenancy is checked server-side. InsForge row access must be scoped to the authenticated user — flag any query filtering only by client-supplied IDs.
- Session/refresh handling: token storage (httpOnly cookies vs localStorage), rotation, logout invalidation.
- Privilege boundaries: admin routes, internal endpoints, debug routes left enabled in production.
- Rate limiting & brute-force protection on auth endpoints, password reset, and any expensive endpoint.

## PHASE 3 — INPUT HANDLING & INJECTION

- SQL: all PostgreSQL/InsForge queries parameterized? Flag any string-built SQL, including in migrations and admin scripts.
- Validation: every external input (body, query, params, headers, webhook payloads, file uploads) validated with a schema (zod/joi/pydantic) before use. Flag pass-through `req.body` spreads into DB writes (mass assignment).
- File uploads: type/size limits, no path traversal in filenames, storage outside web root / in InsForge storage with correct bucket policy.
- SSRF: any server-side fetch of user-supplied URLs — require allowlist or block internal ranges.
- XSS: any `dangerouslySetInnerHTML`, unescaped template injection, or user content rendered as HTML.
- Command execution: any `exec`/`spawn`/`subprocess` with interpolated input.

## PHASE 4 — DEPENDENCIES & SUPPLY CHAIN

- Run `npm audit` / `pip-audit` (or read lockfiles if offline) and triage CRITICAL/HIGH with actual exploitability assessment in this codebase — note whether the vulnerable path is reachable.
- Flag unmaintained or typo-suspicious packages, install scripts (`postinstall`) in dependencies, and any dependency pulled from a non-registry URL.
- Dockerfiles: pinned base images, non-root user, no secrets in layers, multi-stage builds, `.dockerignore` excludes `.env`/`.git`.
- CI workflows: no `pull_request_target` foot-guns, secrets not exposed to fork-triggered runs, actions pinned.

## PHASE 5 — AI/LLM SURFACE (only if AI_FEATURES = yes)

Apply OWASP Top 10 for LLM Applications:

- Prompt injection: user content concatenated into system prompts without delimiting/sanitization; tool-use outputs fed back unchecked.
- Output handling: LLM output executed, eval'd, rendered as HTML, or used in queries without validation (LLM02).
- Excessive agency: AI endpoints that can write to DB/storage — verify scoped permissions and human-review gates where destructive.
- Cost/DoS controls: max token limits, per-user rate limits on AI endpoints, timeout handling.
- Data leakage: PII or secrets included in prompts sent to external model providers; logging of full prompts/completions.

## PHASE 6 — RELIABILITY & DATA INTEGRITY

- Error handling: unhandled promise rejections, missing try/catch on external calls, stack traces leaked in API responses.
- DB: missing indexes on hot foreign keys/WHERE columns, missing `NOT NULL`/FK constraints where the code assumes them, transactions around multi-step writes.
- Webhooks: signature verification (Stripe/etc.), idempotency on retried events.
- Health checks and graceful shutdown for Railway deploys.

## PHASE 7 — FIX EXECUTION

For each CRITICAL/HIGH (and safe MEDIUM):

1. State the finding: severity, `file:line`, evidence quote, exploit scenario in one sentence.
2. Apply the minimal fix.
3. Run build + typecheck + tests; paste pass/fail.
4. Commit: `audit(<phase>): <fix summary>`.

## FINAL REPORT (required output)

```
# <APP_NAME> Find & Fix Audit Report — <date>

## Executive Summary
<3 sentences: overall posture, count by severity, what was fixed vs deferred>

## Findings & Fixes
| # | Severity | Phase | File:Line | Finding | Status (FIXED/DOCUMENTED) | Commit |

## Manual Actions Required (Railway/InsForge dashboards, key rotations, migrations)
- [ ] <action> — <why> — <urgency>

## Deferred / Accepted Risk
| Finding | Severity | Reason deferred | Suggested timeline |

## Verification Evidence
<build/test output snippets per phase>
```

Begin with Phase 0. Do not skip phases. Do not summarize a phase as "clean" without listing what you actually inspected.
