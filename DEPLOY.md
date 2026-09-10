# Eco-Auditor — Railway Deployment

## Architecture

- **Frontend**: React SPA built with Vite, served as static files
- **Backend**: Express.js minimal server (`server.cjs`) serving static files + video streaming
- **Database**: InsForge (Backend-as-a-Service) — the server also connects to InsForge's Postgres directly via `DATABASE_URL` (`pg` pool) for app data; InsForge additionally provides auth, storage, and email
- **Payments**: Stripe Checkout, Billing Portal, and Webhooks (backend API routes implemented in `server.cjs`)

## Deployment Steps

### 1. Environment Variables

Set these in Railway's service variables (Dashboard → Variables tab):

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
```

### 2. Build Configuration

The project uses a **Dockerfile** for production builds:

```bash
railway up   # Deploys using the Dockerfile
```

The Dockerfile is a multi-stage build that:
1. Builds the React SPA with Vite
2. Copies only production dependencies + built static files to a minimal Alpine image
3. Runs as a non-root user (`appuser`)
4. Includes a HEALTHCHECK endpoint at `/health`

### 3. Health Checks

Railway does **not** consume the Dockerfile's `HEALTHCHECK` instruction (that only applies to Docker-native runtimes). Railway gates deploys on the `healthcheckPath` configured in `railway.toml`:

- **Deploy gate**: `[deploy] healthcheckPath = "/ready"` with `healthcheckTimeout = 100` — the deployment is marked live only after `/ready` responds within the timeout
- **Liveness**: `GET /health` → 200 with `{ status: "ok", uptime, version, timestamp }`
- **Readiness**: `GET /ready` → 200 with `{ status: "ok"|"degraded", video: "available"|"not-found" }` (a missing intro video reports `degraded` but still returns 200, so it does not block deploys)

The Dockerfile also carries a `HEALTHCHECK` (15s timeout) for local `docker run` monitoring; Railway ignores it.

### 4. Graceful Shutdown

The server handles `SIGTERM` and `SIGINT`:
- Stops accepting new connections
- Drains in-flight requests
- Exits within 9 seconds (under Railway's 10s grace period)
- Force-exits after 9s timeout

### 5. Video Asset Volume (Optional)

If hosting the intro video via Railway volume:

```bash
# Create a volume mounted at /app/videos
railway volume create --mount /app/videos
# Upload the video file to the volume
railway run cp static/eco-auditor-intro.mp4 /app/videos/
```

### 6. Stripe Webhooks

Configure in Stripe Dashboard:
- **Endpoint URL**: `https://your-app.up.railway.app/api/webhook`
- **Events**: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`

### 7. Custom Domain (Optional)

```bash
railway domain add eco-auditor.developer312.com
```

### 8. Cloudflare www Redirect Rule (Required before launch)

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

- **Logs**: `railway logs` or Railway Dashboard → Deployments → Logs
- **Metrics**: Railway Dashboard → Metrics tab
- **Health**: `curl https://your-app.up.railway.app/health`

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Build fails with `CustomEvent is not defined` | Ensure the Dockerfile uses `node:22-alpine` (Railway builds the Dockerfile; no Nixpacks is involved) |
| App crashes on startup | Check `PORT` env var is set; server binds to `0.0.0.0:$PORT` |
| Video returns 404 | Upload video to `/app/videos/` volume mount or place in `static/` |
| Stripe not working | Check `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` env vars; verify webhook endpoint URL in Stripe dashboard |
| Static assets not cached | Server sets `Cache-Control: immutable` for `/assets/*` and `no-cache` for HTML |