# ─── Stage 1: Build ───
FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Vite bakes env vars at build time — pass as build args
# ARG must come AFTER COPY to invalidate cache when values change
ARG VITE_STRIPE_PK
ARG VITE_INSFORGE_BASE_URL
ARG VITE_INSFORGE_ANON_KEY

COPY . .
ENV VITE_STRIPE_PK=$VITE_STRIPE_PK
ENV VITE_INSFORGE_BASE_URL=$VITE_INSFORGE_BASE_URL
ENV VITE_INSFORGE_ANON_KEY=$VITE_INSFORGE_ANON_KEY
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
COPY server.cjs emissions-engine.cjs server-security.cjs server-billing.cjs emission-factors.cjs emission-factors.json plan-limits.json ./

# server.cjs require()s the report generator from its src/ path, so that one
# file has to exist at the same relative location inside the image. Without it
# the container does not start at all — `node server.cjs` exits immediately with
# "Cannot find module './src/lib/reports/report-generator.cjs'". Only the two
# pure helpers (buildReportText, createSimplePdf) are used at runtime; the
# fixture-driven generateSampleReportFiles is build-time only, so the JSON
# fixture deliberately stays out of the image.
COPY src/lib/reports/report-generator.cjs ./src/lib/reports/report-generator.cjs
COPY --from=builder /app/static ./static

# Volume mount point for video assets
RUN mkdir -p /app/videos && chown appuser:appgroup /app/videos

# Runtime file-storage directory (leads/consent audit fallback JSON)
RUN mkdir -p /app/.data && chown appuser:appgroup /app/.data

USER appuser

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

CMD ["node", "server.cjs"]
