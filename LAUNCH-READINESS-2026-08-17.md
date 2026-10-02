# Launch Readiness — Open for Business (2026-08-17)

Scope: flip EcoAuditor from "beta" to live paid SaaS, per eco-Audit-8-17-perplex.txt.
Evidence-first; minimal diff. Full-surface audit trails already exist in
`AUDIT_REPORT.md` and `docs/audits/` — this pass verifies the launch gate only.

## Changes

| ID | Priority | Area | Change | Evidence | Status |
|----|----------|------|--------|----------|--------|
| L-1 | P1 | Marketing/UX | Hero badge "Now in beta — built for SMBs" → "Now live — open for business" (LandingPage.tsx:104). Only live-code "beta" reference (git grep). | Verified in prerendered `static/index.html` after build | Fixed |
| L-2 | P1 | Billing config | `STRIPE_PRICE_*` (6 price IDs) required by `server.cjs` checkout allowlist + `server-billing.cjs` plan resolution were absent from `.env.example` and `railway.env.example` — paid checkout could not be configured from docs. Added all six + `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`VITE_STRIPE_PK` to `.env.example`; price IDs to `railway.env.example`. | `server.cjs:1054-1059` allowlist; `src/content/pricing.ts` launch checklist | Fixed |
| L-3 | P3 | Lint | Pre-existing `no-explicit-any` error in `tests/publish-endpoint.test.ts:31` blocking `npm run lint` | eslint output | Fixed (`body` typed) |

## Verified payment readiness (no change needed)

- `POST /api/checkout` allowlists price IDs server-side, auth-gated, rejects client-controlled prices (server.cjs:1068-1105).
- Trial restricted to Starter/Growth monthly, once per customer (server.cjs:1092-1102).
- Webhook signature verification required; 24h bounded retry then ack (server-billing.cjs).
- Unrecognized active price degrades to Starter instead of paywalling a paying customer (server-billing.cjs:88-95).
- `POST /api/checkout/verify` reconciles return-from-Stripe hop (server.cjs:1115+).
- Plan limits enforced server-side from `plan-limits.json` (facilities, CSV imports, Scope 3).

## Commands run

- `npm run lint` → pass (1 pre-existing error fixed)
- `npm test` → 189/189 pass (23 files)
- `npm run build` → pass; prerender 14/14 routes; "Now live — open for business" confirmed in static output

## Remaining human actions (cannot be done from the repo)

1. Create live Stripe products/prices (Starter/Growth/Pro × monthly/annual) and set the six
   `STRIPE_PRICE_*` vars + `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VITE_STRIPE_PK` in Railway.
2. Point the Stripe webhook endpoint at the deployed `/api/webhook` URL (`https://ecoauditor.io/api/webhook`).
   Corrected 2026-09-30: the path given here before does not exist and answers 404.
3. Reconcile `src/content/pricing.ts` amounts against the live Stripe price amounts (pricing.ts checklist item 3).
