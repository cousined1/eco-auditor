# PRODUCTION-READINESS AUDIT — Full System

> **Mode**: GODMYTHOS v7 · ULTRATHINK · Large Scope
> **Directive**: Perform an exhaustive production-readiness audit of the entire application. Every issue found must be fixed in-place — no TODOs, no placeholders, no deferred work. Treat this as preparing a system that handles real users, real money, and real data starting tomorrow.

---

## PHASE 1 — CODEBASE SCAN & REPAIR

### 1A. Static Analysis
Scan every file for:
- Runtime errors, logic errors, off-by-one mistakes, unreachable code, dead code
- Missing/circular imports, broken references, unresolved modules
- Unhandled exceptions, unhandled promise rejections, missing `.catch()` on async chains
- `async/await` misuse (missing `await`, floating promises, async functions that never throw)
- Race conditions in shared state, database writes, or concurrent request handlers
- Memory leaks (unclosed connections, orphaned listeners, unbounded caches, growing arrays)
- Deprecated APIs (Node, React, library-specific)
- Hardcoded secrets, credentials, or environment-specific values in source
- Missing or incomplete TypeScript types (any `any` that should be typed, missing return types on exported functions)

### 1B. Repair Rules
- **Fix** every issue in-place.
- **Rewrite** fragile code (long chains of nested callbacks, god functions, unclear control flow).
- **Add** `try/catch` or error boundaries wherever an unhandled failure could crash the process or corrupt state.
- **Add** input validation at every system boundary (API routes, CLI args, env vars, file reads, external API responses).
- **Add** structured logging (`level`, `timestamp`, `requestId`, `context`) to every catch block — never swallow errors silently.

---

## PHASE 2 — SECURITY HARDENING

Audit and fix each layer:

| Layer | Requirements |
|---|---|
| **Authentication** | Verify signup/login/logout/refresh flows. Passwords hashed with bcrypt (cost ≥ 12) or argon2. JWTs signed with RS256 or HS256 + rotatable secret. Refresh tokens stored httpOnly + secure + sameSite. Token expiry ≤ 15 min access / ≤ 7 day refresh. |
| **Authorization** | Role/permission checks on every protected route and resolver. No client-side-only gates. Verify ownership checks on resource-level operations (user A can't access user B's data). |
| **Session/Token** | Invalidation on logout/password change. Revocation list or short-lived tokens. No tokens in URLs or localStorage. |
| **Rate Limiting** | Applied to auth endpoints (strict: 5–10/min), API endpoints (moderate), and webhook ingress. Use sliding window, not fixed. Return `Retry-After` header. |
| **CORS** | Explicit allowlist of origins. No wildcard `*` in production. Credentials mode configured correctly. |
| **Input Sanitization** | All user input validated and sanitized before DB writes. Parameterized queries only — zero string concatenation in SQL. XSS protection on any rendered user content. |
| **Dependencies** | Run `npm audit` / `pip audit`. Upgrade or replace any package with known critical/high CVEs. Pin major versions. |
| **Secrets** | All secrets loaded from env vars or a vault. `.env` files in `.gitignore`. No secrets in Docker layers, logs, or error responses. |
| **Headers** | Helmet.js or equivalent: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Content-Security-Policy`. |
| **Error Exposure** | Production error responses must never leak stack traces, internal paths, DB schemas, or query details. |

---

## PHASE 3 — STRIPE BILLING VERIFICATION

### 3A. Configuration Validation
- Verify `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET` are present, correctly formatted (`sk_live_*` / `sk_test_*`), and loaded from env.
- Verify all referenced `price_*` and `prod_*` IDs exist and are active in the target Stripe environment.
- Verify test-mode keys are **never** used in production builds (add a build-time or startup check).

### 3B. Flow Validation
- **Customer creation**: Idempotent — check for existing customer by email before creating. Store `stripe_customer_id` on user record.
- **Checkout session**: Correct `mode` (`subscription` vs `payment`). `success_url` and `cancel_url` include session ID or checkout token for verification. `client_reference_id` links back to internal user.
- **Subscription lifecycle**: Handle `customer.subscription.created`, `updated`, `deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`, `checkout.session.completed`. Update internal subscription state atomically.
- **Webhook handler**: Verify signature with `stripe.webhooks.constructEvent()`. Return `200` quickly (offload heavy processing). Idempotent — handle duplicate delivery gracefully. Log and alert on verification failures.
- **Error handling**: Catch `StripeCardError`, `StripeInvalidRequestError`, `StripeAPIError` separately. Return user-friendly messages. Never expose raw Stripe errors to the client.
- **Cancellation/refund**: Verify downgrade logic, proration handling, and access revocation timing.

---

## PHASE 4 — DATABASE VERIFICATION

### 4A. Connection & Config
- Connection pooling configured (min/max connections, idle timeout, connection timeout).
- SSL/TLS enabled for production connections.
- Graceful shutdown drains the pool.
- Connection string loaded from env, not hardcoded.

### 4B. Schema & Integrity
- All tables have primary keys.
- Foreign keys exist for every relationship with appropriate `ON DELETE` behavior (`CASCADE`, `SET NULL`, or `RESTRICT` — no silent orphans).
- Unique constraints on business-critical fields (email, stripe_customer_id, slug, etc.).
- `NOT NULL` on required fields. Sensible defaults on optional fields.
- `created_at` and `updated_at` timestamps on every table.
- Indexes on every foreign key column and every column used in `WHERE`, `ORDER BY`, or `JOIN`.

### 4C. Migrations
- Migration files are sequential, idempotent, and reversible.
- No raw SQL that bypasses the migration system.
- Seed data separated from schema migrations.

### 4D. ORM & Query Safety
- No raw string interpolation in queries.
- Transactions wrap any multi-step writes (especially Stripe sync + DB update).
- N+1 queries identified and fixed with eager loading or batching.
- Large result sets paginated (cursor-based preferred over offset).

---

## PHASE 5 — TEST SUITE GENERATION

Generate a complete, runnable test suite. Structure:

```
tests/
├── unit/                  # Pure logic, utilities, helpers
├── integration/           # API routes, middleware chains, DB interactions
├── billing/               # Stripe flows (mocked with stripe-mock or jest mocks)
├── auth/                  # Signup, login, token refresh, permission checks
├── db/                    # Schema validation, migration up/down, constraint tests
├── e2e/                   # Full user flows (Playwright preferred)
├── load/                  # k6 scripts: baseline, spike, soak
├── fixtures/              # Seed data, mock responses, test users
├── helpers/               # Shared setup/teardown, factories, custom matchers
├── jest.config.ts         # (or vitest.config.ts)
├── playwright.config.ts
└── k6/
    └── scenarios/
```

### Coverage Targets
| Category | Min Coverage |
|---|---|
| Unit | 80% line coverage |
| Integration (API) | Every route, every error code |
| Auth | Every flow + every rejection path |
| Billing | Happy path + every webhook event + signature failure + idempotency |
| DB | Schema matches ORM models, constraints enforced, migrations reversible |
| E2E | Signup → subscribe → use app → cancel → verify access revoked |
| Load | Baseline: sustained 100 RPS. Spike: 5x burst. Soak: 1 hour steady. |

### Requirements
- All mocks are realistic (correct shapes, edge cases, error states).
- No test depends on execution order.
- CI config included (GitHub Actions preferred): lint → type-check → unit → integration → e2e → load (on schedule only).
- Tests run against a disposable test database (Docker Compose or testcontainers).

---

## PHASE 6 — PRODUCTION BUILD & DEPLOYMENT VALIDATION

### 6A. Build
- `npm run build` (or equivalent) completes with zero errors and zero warnings.
- Output is minified, tree-shaken, and source-mapped (maps excluded from production serving).
- All env vars validated at startup — fail fast with clear error messages if missing.

### 6B. Dockerfile
- Multi-stage build. Final image is minimal (distroless or alpine).
- No dev dependencies, source maps, `.env` files, or secrets in the final layer.
- Non-root user. Read-only filesystem where possible.
- `HEALTHCHECK` instruction present.

### 6C. Observability
- **Health check endpoint**: `GET /health` returns `200` with DB connectivity status, uptime, and version.
- **Readiness endpoint**: `GET /ready` returns `200` only when the app can serve traffic.
- **Structured logging**: JSON format, includes `requestId`, `userId`, `level`, `timestamp`.
- **Error reporting**: Unhandled exceptions reported to Sentry (or equivalent). Source maps uploaded to error service.
- **Metrics**: Request count, latency histogram, error rate, active connections, Stripe webhook processing time.

### 6D. Deployment Config
- Graceful shutdown handler (drain connections, finish in-flight requests, close DB pool).
- `NODE_ENV=production` enforced.
- HTTPS enforced (redirect HTTP → HTTPS or terminate at load balancer).
- Static assets served with cache headers (`Cache-Control: public, max-age=31536000, immutable` for hashed files).

---

## PHASE 8 — DELIVERABLES

1. **The fully patched codebase** — every file touched is saved. Zero TODOs, zero placeholders.
2. **AUDIT_REPORT.md** — structured summary:
   - Total issues found (by severity: critical / high / medium / low)
   - Each issue: location, description, fix applied
   - Security findings section
   - Stripe findings section
   - Database findings section
3. **PRODUCTION_CHECKLIST.md** — a pass/fail checklist confirming:
   - [ ] All critical/high issues resolved
   - [ ] Auth flows tested and hardened
   - [ ] Stripe billing verified end-to-end
   - [ ] Database schema validated with constraints and indexes
   - [ ] Test suite passes (unit, integration, e2e)
   - [ ] Build succeeds with zero warnings
   - [ ] Dockerfile builds and runs
   - [ ] Health/readiness endpoints respond
   - [ ] Secrets loaded from env only
   - [ ] Rate limiting active
   - [ ] Error reporting configured
   - [ ] Graceful shutdown implemented
   - [ ] Railway: app binds to `$PORT` on `0.0.0.0`
   - [ ] Railway: `DATABASE_URL` with SSL, pool sized, migrations auto-run
   - [ ] Railway: Stripe webhook reachable and signature-verified
   - [ ] Railway: `SIGTERM` → clean shutdown within 10s
   - [ ] Railway: missing env var → fail fast, not silent crash
   - [ ] Railway: deployment artifacts generated (`railway.json`, env template, DEPLOY.md)
4. **Complete test suite** — runnable immediately with a single command.
5. **Railway deployment artifacts** — `railway.json`, Nixpacks config, env var template, deploy instructions.

---

## PHASE 7 — RAILWAY DEPLOYMENT READINESS

This phase is **mandatory**. The app deploys to Railway — every item below must pass.

### 7A. Environment Variables
- Every required env var has a corresponding entry in Railway's service variables.
- No secrets hardcoded in source, Dockerfile, or build scripts.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `DATABASE_URL`, `NODE_ENV=production` all confirmed present.
- Env var template file generated (`railway.env.example`) listing every variable with descriptions and dummy values.

### 7B. Service Configuration
- Start command is explicit and correct (e.g., `node dist/server.js`, not `npm start` pointing to dev).
- Build command produces a production artifact (`npm run build` or equivalent).
- App binds to `process.env.PORT` — no hardcoded port numbers.
- Correct Node/Python version specified in `package.json` (`engines`), `.node-version`, or Nixpacks config.
- Buildpack detection verified — if Nixpacks needs overrides, provide `nixpacks.toml` or `[build]` section in `railway.json`.

### 7C. Networking
- Server listens on `0.0.0.0`, not `localhost` or `127.0.0.1`.
- Port comes from `process.env.PORT` with no fallback in production (fail fast if missing).
- `GET /health` and `GET /ready` are exposed and return within 5 seconds.
- Stripe webhook URL uses the Railway public domain (`https://<service>.up.railway.app/api/webhooks/stripe`). Webhook endpoint is registered in Stripe dashboard with correct path.
- No firewall or middleware blocks incoming POST to webhook routes.

### 7D. Database
- Railway Postgres (or MySQL/Redis) service is linked — `DATABASE_URL` is auto-injected by Railway.
- Connection string parsed correctly (handle Railway's `postgresql://` format including `?sslmode=require`).
- SSL mode is `require` or `no-verify` for Railway Postgres — never `disable` in production.
- Connection pool sized for Railway's container limits (max 10–20 connections typical).
- Migrations run automatically on deploy — either via a build script, release command, or app startup with idempotency guard.
- Connection retry logic with exponential backoff (Railway DB may take a few seconds to accept connections on cold start).

### 7E. Volumes (if applicable)
- Mount paths are absolute and match Railway volume config.
- App handles the case where the volume is empty on first deploy.
- File permissions are correct (non-root user can read/write).
- No critical application state stored solely on volumes without backup.

### 7F. Deployment Behavior
- Zero-downtime deploys: app signals readiness only after DB connection + migrations complete. Railway health check gates traffic.
- Graceful shutdown: `SIGTERM` handler drains HTTP connections, closes DB pool, flushes logs, then exits 0. Timeout ≤ Railway's shutdown grace period (default 10s).
- No crash loops: startup failures log a clear error and exit non-zero (don't retry infinitely).
- Logs are structured JSON — Railway's log viewer can parse them. No `console.log` of objects without serialization.
- Unhandled rejections and uncaught exceptions are caught, logged, and trigger a clean exit.

### 7G. Deployment Artifacts
Generate these files if they don't exist:

| File | Purpose |
|---|---|
| `railway.json` | Service config: build/start commands, health check path, restart policy |
| `nixpacks.toml` | Build overrides if needed (Node version, install/build commands) |
| `Dockerfile` | Multi-stage production build (if not using Nixpacks) |
| `railway.env.example` | Every env var with description and placeholder |
| `DEPLOY.md` | Step-by-step Railway deployment instructions |

### 7H. Preflight Simulation
Before declaring ready, verify each scenario:

| Scenario | Validation |
|---|---|
| Build | `npm run build` exits 0, output exists, no missing deps |
| Startup | App starts, binds to `$PORT`, `/health` returns 200 within 10s |
| DB connection | App connects to `$DATABASE_URL`, migrations run, queries succeed |
| Stripe webhook | POST to `/api/webhooks/stripe` with valid signature → 200, invalid signature → 400 |
| Health check | `GET /health` returns 200 with `{ status: "ok", db: "connected", version: "..." }` |
| Graceful shutdown | Send `SIGTERM` → app closes connections and exits 0 within 10s |
| Missing env var | Remove a required var → app fails fast with clear error, not a cryptic crash |

---

**Execute all phases sequentially. Do not skip. Do not ask for confirmation between phases. Begin.**
