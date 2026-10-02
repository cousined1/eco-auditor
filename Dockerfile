# ─── Stage 1: Build ───
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Vite bakes env vars at build time. Railway passes a service variable to a
# Dockerfile build only when the Dockerfile declares it with ARG, so these ARG
# lines are what inject VITE_* (railway.toml's [[build.args]] entries are not a
# documented Railway key and are not needed). A new VITE_ variable needs an ARG here.
# ARG must come AFTER COPY to invalidate cache when values change
ARG VITE_STRIPE_PK
ARG VITE_INSFORGE_BASE_URL
ARG VITE_INSFORGE_ANON_KEY
# VITE_GTM_ID is set as a Railway service variable and reaches the build through
# this ARG: Vite inlines it into the bundle at build time. Without it here,
# GTM_ID is '' in the image and analytics silently never loads — no pageviews,
# no conversions, no way to attribute ad spend. See
# ecoauditor-mvp-readiness-audit-2026-08-20.md (E-5).
ARG VITE_GTM_ID

COPY . .
ENV VITE_STRIPE_PK=$VITE_STRIPE_PK
ENV VITE_INSFORGE_BASE_URL=$VITE_INSFORGE_BASE_URL
ENV VITE_INSFORGE_ANON_KEY=$VITE_INSFORGE_ANON_KEY
ENV VITE_GTM_ID=$VITE_GTM_ID
RUN npm run build

# ─── Stage 2: Production ───
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920

WORKDIR /app

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package*.json ./
RUN npm ci --omit=dev

# emission-factors.json is the shared factor catalog and emission-factors.cjs
# its server-side lookup — the engine require()s both at runtime, so they must
# ship. src/ is not in this image, hence the root-level location.
# server-publish.cjs is in this list because server.cjs require()s it at the
# top level: omitting it does not disable /api/publish, it kills the whole
# process with MODULE_NOT_FOUND on boot and every route 502s. Any new
# root-level server module has to be added here too.
# server-http-utils.cjs is in this list because server.cjs require()s it for the
# /api/video Range handler and the static asset cache policy (RT-04/RT-05 extraction).
# server-notify.cjs is in this list because server.cjs require()s it for the lead
# notifier (F-A-07): a lead-capture surface without it would not just lose the
# notification, the process would not boot.
# server-entries.cjs and server-entry-routes.cjs are the emission-entry write API
# and the locked facility insert (K2); server.cjs require()s both at the top level.
# emission-factors.v1.json is the frozen 2026-07-24 catalog that prices every
# stored row without a pin; emission-factors.cjs require()s it at the top level.
# server-csv-import.cjs, server-csv-import-routes.cjs, server-csv-import-store.cjs and
# units.cjs are the CSV import (validation, commit/undo transactions, their SQL, unit
# conversion; K4), required the same way.
# server-company.cjs and server-company-routes.cjs are the company profile,
# onboarding and facility-edit routes (K5); server.cjs require()s both at the top
# level, and ensureCompanyForUser names the placeholder company through the first.
COPY server.cjs server-publish.cjs server-notify.cjs server-entries.cjs server-entry-routes.cjs server-csv-import.cjs server-csv-import-routes.cjs server-csv-import-store.cjs units.cjs server-company.cjs server-company-routes.cjs emissions-engine.cjs server-security.cjs server-billing.cjs server-http-utils.cjs emission-factors.cjs emission-factors.json emission-factors.v1.json plan-limits.json ./

# server-pages.cjs and server-blog-render.cjs render /blog/, /blog/<slug>/ and
# sitemap.xml per request (F-F-01); server.cjs require()s them at the top level
# like every module above, and reads the /blog head from route-meta.json, the same
# file the prerender step and the pages read, at its src/ path.
COPY server-pages.cjs server-blog-render.cjs ./
COPY src/content/route-meta.json ./src/content/route-meta.json

# Config, failure handling, access log and client error reports, and compression
# (F-G-06, F-G-08, F-G-13, F-G-18): server.cjs require()s all four at the top
# level, so the process does not boot without them.
COPY server-config.cjs server-errors.cjs server-observability.cjs server-compression.cjs ./

# server.cjs require()s the report generator from its src/ path, so that one
# file has to exist at the same relative location inside the image. Without it
# the container does not start at all — `node server.cjs` exits immediately with
# "Cannot find module './src/lib/reports/report-generator.cjs'". Only the pure
# helpers (the PDF renderer) are used at runtime; the fixture-driven
# generateSampleReportFiles is build-time only, so the JSON fixture deliberately
# stays out of the image. pdf-document.cjs is the PDF writer the generator
# requires; report-snapshot.cjs builds the frozen report record (K3) and reads
# ../../../emission-factors.json, copied above; report-limits.cjs is the
# per-company generate limit server.cjs require()s at the top level.
COPY src/lib/reports/report-generator.cjs ./src/lib/reports/report-generator.cjs
COPY src/lib/reports/pdf-document.cjs src/lib/reports/report-snapshot.cjs src/lib/reports/report-limits.cjs ./src/lib/reports/
COPY --from=builder /app/static ./static

# Volume mount point for video assets
RUN mkdir -p /app/videos && chown appuser:appgroup /app/videos

USER appuser

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=15s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

CMD ["node", "server.cjs"]
