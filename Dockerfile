# ─── Stage 1: Build ───
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ─── Stage 2: Production ───
FROM node:22-alpine

WORKDIR /app

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.cjs ./
COPY --from=builder /app/static ./static

# Volume mount point for video assets
RUN mkdir -p /app/videos && chown appuser:appgroup /app/videos

USER appuser

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

CMD ["node", "server.cjs"]