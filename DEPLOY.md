# Eco-Auditor — Railway Deployment

## Architecture

- **Frontend**: React SPA built with Vite, served as static files
- **Backend**: Express.js minimal server (`server.cjs`) serving static files + video streaming
- **Database**: InsForge (Backend-as-a-Service) — the server also connects to InsForge's Postgres directly via `DATABASE_URL` (`pg` pool) for app data; InsForge additionally provides auth, storage, and email
- **Payments**: Stripe Checkout, Billing Portal, and Webhooks (backend API routes implemented in `server.cjs`)

## Deployment Steps

**Releasing the audit-fix change set (new migrations, new server image, production data fixes, late enforcement)? Follow
[docs/runbooks/release-order.md](docs/runbooks/release-order.md) instead of the short list below: the order matters
(migrate before you deploy the image, fix the live blog rows before the blog renders, apply the REVOKE last).**

### 1. Environment Variables

Set these in Railway's service variables (Dashboard → Variables tab). The complete list, with defaults and what breaks without each one, is `railway.env.example`, which `tests/env-schema-parity.test.ts` holds to `server-config.cjs`; a production boot logs one warning per missing or development-only variable. The blog publisher also needs `SITE_DEPLOY_TOKEN`.

```env
# Required
PORT=3000                          # Railway injects this; DO NOT hardcode
NODE_ENV=production                # Production mode
DATABASE_URL=postgres://...        # InsForge Postgres connection string; boot fails in production without it
VITE_INSFORGE_BASE_URL=https://your-app.up.railway.app   # InsForge backend URL
VITE_INSFORGE_ANON_KEY=your-anon-key                       # InsForge anonymous key

# Required for billing (when Stripe is wired)
APP_URL=https://ecoauditor.io      # Public base URL for Stripe redirects; boot fails without it when STRIPE_SECRET_KEY is set
STRIPE_SECRET_KEY=sk_live_...      # Stripe secret key
STRIPE_WEBHOOK_SECRET=whsec_...    # Stripe webhook signing secret
STRIPE_PRICE_STARTER_MONTHLY=price_...
STRIPE_PRICE_STARTER_ANNUAL=price_...
STRIPE_PRICE_GROWTH_MONTHLY=price_...
STRIPE_PRICE_GROWTH_ANNUAL=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_ANNUAL=price_...  # One price ID per plan x billing interval; missing ones cannot be purchased

# Optional
VITE_STRIPE_PK=pk_live_...         # Stripe publishable key (build-time)

# Recommended in production (consent audit trail)
CONSENT_IP_PEPPER=<hex>            # HMAC pepper pseudonymizing visitor IPs in consent records (server.cjs); generate once via a secret manager
```

Set `CONSENT_IP_PEPPER` in production. Generate it once (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), store it in your secret manager, and never commit the real value. If unset, the server falls back to a random per-process pepper: consent IP hashes are not stable across restarts/redeploys (a warn is logged at boot). Rotating the value invalidates the longitudinal linkage of previously recorded consent-IP hashes.

### 2. Migration prerequisites (InsForge-managed Postgres bootstrap)

Migrations in `migrations/` are **not standalone SQL**: they depend on the InsForge-managed auth layer that production InsForge provisions silently. On a non-InsForge or self-managed Postgres, create this bootstrap before applying migrations, or `20260611141026_initial-schema.sql` fails with `schema "auth" does not exist` followed by cascading `relation does not exist` and `role "authenticated" does not exist` errors (with `ON_ERROR_STOP=0`, naive tooling can mask the partial apply as "OK").

Required before applying migrations outside InsForge:

- Schema `auth` with table `auth.users` (`id UUID` primary key) - migrations reference `auth.users(id)` (e.g. the `companies.user_id` foreign key)
- Function `auth.uid()` returning `uuid` - used by the row-level security policies (`user_id = (SELECT auth.uid())`)
- Roles `authenticated` and `anon` - policies are declared `TO authenticated` / `TO anon` (public lead writes) and billing columns are granted `TO authenticated`
- Role `service_role` - part of the InsForge-managed bootstrap set; the InsForge server API operates with it

On InsForge-managed Postgres none of this is manual: `npm run db:migrate` applies all migrations through the InsForge CLI. Verify migration state before deploying with `npm run db:migrate:check` (wired as a CI step in `.github/workflows/security.yml`, INFRA-D2).

### 3. Build Configuration

The project uses a **Dockerfile** for production builds:

```bash
railway up   # Deploys using the Dockerfile
```

The Dockerfile is a multi-stage build that:
1. Builds the React SPA with Vite
2. Copies only production dependencies + built static files to a minimal Alpine image
3. Runs as a non-root user (`appuser`)
4. Includes a HEALTHCHECK endpoint at `/health`

### 4. Health Checks

Railway does **not** consume the Dockerfile's `HEALTHCHECK` instruction (that only applies to Docker-native runtimes). Railway gates deploys on the `healthcheckPath` configured in `railway.toml`. Config as code is deprecated and honoured for legacy services only until 2026-12-01, so the same settings must also be in the service settings before then: see `docs/runbooks/railway-settings.md`.

- **Deploy gate**: `[deploy] healthcheckPath = "/ready"` with `healthcheckTimeout = 100` — the deployment is marked live only after `/ready` answers 200 within the timeout
- **Liveness**: `GET /health` (and `/api/health`) → 200 with `{ status: "ok", sha }`; 503 with `{ status: "degraded", sha }` when the database is unreachable
- **Readiness**: `GET /ready` → 200 `{ "status": "ok" }` when the app can serve (database reachable, or none configured); 503 `{ "status": "degraded" }` when the configured database is unreachable. The body carries nothing else; the probe failure is logged (`Database health probe failed`). The intro video is not part of readiness.
- **Version**: `GET /api/version` → `{ "version": "<package.json version>" }`. `APP_VERSION` overrides it only when it is valid semver and not older than `package.json`; otherwise it is ignored with a boot warning (delete a stale one).

The Dockerfile also carries a `HEALTHCHECK` (15s timeout) for local `docker run` monitoring; Railway ignores it.

### 5. Graceful Shutdown

The server handles `SIGTERM` and `SIGINT`:
- Stops accepting new connections
- Drains in-flight requests
- Exits within 9 seconds (under Railway's 10s grace period)
- Force-exits after 9s timeout

### 6. Video Asset Volume (Optional)

If hosting the intro video via Railway volume:

```bash
# Create a volume mounted at /app/videos
railway volume create --mount /app/videos
# Upload the video file to the volume
railway run cp static/eco-auditor-intro.mp4 /app/videos/
```

### 7. Stripe Webhooks

Configure in Stripe Dashboard:
- **Endpoint URL**: `https://your-app.up.railway.app/api/webhook`
- **Events**: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`

### 8. Custom Domain (Optional)

```bash
railway domain add eco-auditor.developer312.com
```

### 9. Cloudflare www Redirect Rule (Required before launch)

The apex domain (`ecoauditor.io`) is served through Cloudflare, but `www.ecoauditor.io` currently returns a Cloudflare 526 error because the origin presents an invalid certificate for the `www` hostname. The apex also sends an HSTS header with `includeSubDomains`, so browsers that have previously visited the apex will refuse to bypass the broken `www` certificate. A redirect rule must be applied **at the Cloudflare edge** so `www` requests never reach the origin.

In the Cloudflare dashboard, select your domain and go to **Rules > Redirect Rules**. Create a single redirect rule:

- **When incoming requests match:**
  - Field: `http.host`
  - Operator: `equals`
  - Value: `www.ecoauditor.io`
- **Then:**
  - Type: Dynamic
  - Expression: `concat("https://", substring(http.host, 4), http.request.uri.path)`
  - Status code: `301`
  - Preserve query string: enabled

Example: `https://www.ecoauditor.io/pricing?plan=growth` → `https://ecoauditor.io/pricing?plan=growth`.

This is an infrastructure-only rule; it does not require any application code changes. Deploy it before submitting the domain to the HSTS preload list.

## Monitoring

- **Logs**: `railway logs` or Railway Dashboard → Deployments → Logs. Every request writes one JSON `request` line (method, route pattern, status, `durationMs`, request id); a failed request also writes one `Request failed` line with the stack and driver code; browser errors arrive as `Client error report` lines.
- **Metrics**: Railway Dashboard → Metrics tab
- **Health**: `curl https://your-app.up.railway.app/health`
- **Uptime checks and alerts**: `docs/runbooks/monitoring.md` (what to watch, which free tools fit, the thresholds)

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Build fails with `CustomEvent is not defined` | Ensure the Dockerfile uses `node:22-alpine` (Railway builds the Dockerfile; no Nixpacks is involved) |
| App crashes on startup | Check `PORT` env var is set; server binds to `0.0.0.0:$PORT` |
| Video returns 404 | Upload video to `/app/videos/` volume mount or place in `static/` |
| Stripe not working | Check `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` env vars; verify webhook endpoint URL in Stripe dashboard |
| Static assets not cached | Server sets `Cache-Control: immutable` for `/assets/*` and `no-cache` for HTML |