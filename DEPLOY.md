# Eco-Auditor — Railway Deployment

## Architecture

- **Frontend**: React SPA built with Vite, served as static files
- **Backend**: Express.js minimal server (`server.cjs`) serving static files + video streaming
- **Database**: InsForge (Backend-as-a-Service) — no managed database in this service
- **Payments**: Stripe Checkout, Billing Portal, and Webhooks (requires backend API routes to be added)

## Deployment Steps

### 1. Environment Variables

Set these in Railway's service variables (Dashboard → Variables tab):

```env
# Required
PORT=3000                          # Railway injects this; DO NOT hardcode
NODE_ENV=production                # Production mode
NIXPACKS_NODE_VERSION=22           # Forces Node 22 for Nixpacks builder
VITE_INSFORGE_BASE_URL=https://your-app.up.railway.app   # InsForge backend URL
VITE_INSFORGE_ANON_KEY=your-anon-key                       # InsForge anonymous key

# Required for billing (when Stripe is wired)
STRIPE_SECRET_KEY=sk_live_...      # Stripe secret key
STRIPE_WEBHOOK_SECRET=whsec_...    # Stripe webhook signing secret

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

Railway will automatically use the Dockerfile's HEALTHCHECK:

- **Liveness**: `GET /health` → 200 with `{ status: "ok", uptime, version, timestamp }`
- **Readiness**: `GET /ready` → 200 with `{ status: "ok"|"degraded", video: "available"|"not-found" }`

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
- **Endpoint URL**: `https://your-app.up.railway.app/api/stripe/webhook`
- **Events**: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`

### 7. Custom Domain (Optional)

```bash
railway domain add eco-auditor.developer312.com
```

## Monitoring

- **Logs**: `railway logs` or Railway Dashboard → Deployments → Logs
- **Metrics**: Railway Dashboard → Metrics tab
- **Health**: `curl https://your-app.up.railway.app/health`

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Build fails with `CustomEvent is not defined` | Ensure `NIXPACKS_NODE_VERSION=22` is set and Dockerfile uses `node:22-alpine` |
| App crashes on startup | Check `PORT` env var is set; server binds to `0.0.0.0:$PORT` |
| Video returns 404 | Upload video to `/app/videos/` volume mount or place in `static/` |
| Stripe not working | Ensure backend API routes for `/api/stripe/*` are implemented |
| Static assets not cached | Server sets `Cache-Control: immutable` for `/assets/*` and `no-cache` for HTML |