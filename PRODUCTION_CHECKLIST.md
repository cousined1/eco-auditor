# Eco-Auditor — Production Readiness Checklist

## Infrastructure

- [x] App binds to `$PORT` on `0.0.0.0`
- [x] `NIXPACKS_NODE_VERSION=22` set in Railway env
- [x] Dockerfile uses multi-stage build
- [x] Container runs as non-root user (`appuser`)
- [x] HEALTHCHECK instruction in Dockerfile
- [x] `NODE_ENV=production` set
- [x] `.dockerignore` excludes source, tests, dev files

## Server

- [x] Health check endpoint: `GET /health`
- [x] Readiness endpoint: `GET /ready`
- [x] Security headers: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy
- [x] Rate limiting: 120 req/min per IP sliding window
- [x] Graceful shutdown: SIGTERM/SIGINT handlers, 9s timeout
- [x] Global error handlers: uncaughtException, unhandledRejection
- [x] Structured JSON logging (no console.log of objects)
- [x] Range header validation for video streaming
- [x] Stream error handlers (no unhandled pipe errors)
- [x] Static asset cache headers: immutable for hashed, no-cache for HTML

## Security

- [x] No hardcoded secrets in source code
- [x] All secrets from environment variables
- [x] `STRIPE_PK` not logged to console
- [x] Rate limiting on all endpoints
- [x] No CORS wildcard in production
- [x] `npm audit`: 0 vulnerabilities
- [x] Non-root Docker container
- [x] `.dockerignore` excludes `.env`, `.env.*`, `.git`

## Build

- [x] `npm run build` exits 0
- [x] TypeScript: 0 errors
- [x] Output is minified and tree-shaken
- [x] No source maps in production serving
- [x] Build output in `static/` directory

## Environment Variables

- [x] `PORT` — required, fail-fast if missing
- [x] `NODE_ENV=production` — set in Dockerfile
- [x] `NIXPACKS_NODE_VERSION=22` — set in Railway
- [x] `VITE_INSFORGE_BASE_URL` — set in Railway
- [x] `VITE_INSFORGE_ANON_KEY` — set in Railway
- [x] `VITE_STRIPE_PK` — documented, needs Railway setting
- [x] `STRIPE_SECRET_KEY` — documented, needs Railway setting
- [x] `STRIPE_WEBHOOK_SECRET` — documented, needs Railway setting

## Railway Deployment

- [x] App binds to `$PORT` on `0.0.0.0`
- [x] Health check responds within 10s
- [x] SIGTERM → clean shutdown within 10s
- [x] Missing env var → fail fast with clear error
- [x] `railway.json` configuration file created
- [x] `nixpacks.toml` with Node 22 specified
- [x] Dockerfile with multi-stage build
- [x] `railway.env.example` with all required variables documented
- [x] `DEPLOY.md` with step-by-step instructions

## Stripe Billing

- [x] Client-side `createCheckoutSession` calls real API endpoint
- [x] Client-side `createBillingPortalSession` calls real API endpoint
- [x] Client-side `changeSubscription` calls real API endpoint
- [x] Client-side `cancelSubscription` calls real API endpoint
- [x] All Stripe functions return typed result (`StripeResult<T>`)
- [x] Error states displayed in UI (Pricing, Settings)
- [ ] **Backend Stripe API routes need implementation** (`/api/stripe/checkout`, `/api/stripe/portal`, `/api/stripe/subscription`, `/api/stripe/webhook`)
- [ ] **Stripe webhook signature verification** (needs backend route)
- [ ] **Stripe webhook URL registered** in Stripe Dashboard

## Code Quality

- [x] No `console.log` in production code (server uses structured JSON logging)
- [x] No non-null assertions without null checks
- [x] No array mutation during render
- [x] No floating promises (all async calls awaited)
- [x] No memory leaks (setTimeout cleanup in useEffect)
- [x] No division by zero risks
- [x] TypeScript strict mode enabled

## Test Suite

- [x] Vitest installed and configured
- [x] Server logic tests: rate limiting, security headers, range validation, cache headers, health check, graceful shutdown
- [x] Stripe SDK tests: PRICE_IDS configuration, webhook handler, StripeResult type contract
- [x] Mock data integrity tests: COMPANY, FACILITIES, EMISSIONS_SUMMARY, SUPPLIERS, REPORTS
- [x] InsForge configuration tests: graceful handling of missing env vars, no module-level throws
- [x] All 49 tests passing

## Outstanding Items

1. **Stripe backend routes** — Express server needs `/api/stripe/*` route handlers with signature verification
2. **Missing static assets** — `favicon.svg`, `manifest.webmanifest`, `og-image.png` need to be created
3. **Contact form** — Requires InsForge `contact_submissions` table to exist in the database
4. **Video file** — `eco-auditor-intro.mp4` must be in `static/` or Railway volume `/app/videos/`
5. **Multiple placeholder buttons** — UI buttons with no onClick handlers (by design for MVP phase)