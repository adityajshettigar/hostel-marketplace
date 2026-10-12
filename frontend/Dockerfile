# ---------- dependencies ----------
# devDependencies are REQUIRED for the build (typescript, tailwindcss, postcss).
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

# ---------- builder ----------
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Where the /gw/* rewrite proxies to. Compose sets this to the gateway's
# compose-network hostname; plain local builds default to localhost:4000.
ARG GATEWAY_ORIGIN=http://localhost:4000
ENV GATEWAY_ORIGIN=$GATEWAY_ORIGIN
# Browser-side Cloudinary config (NEXT_PUBLIC_* is inlined into the client
# bundle at build time — see lib/cloudinary.ts). Compose passes these from
# the root .env; empty defaults keep plain local builds working (upload
# simply reports "not configured" at runtime instead of failing the build).
ARG NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=
ARG NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=
ENV NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=$NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
ENV NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=$NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- runner ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Phase 9 (item 5): fail the container at start if any required env var is missing.
COPY --from=builder --chown=nextjs:nodejs /app/scripts/check-env.mjs ./scripts/check-env.mjs

USER nextjs
EXPOSE 3000
# Audit lapse-3 fix: container health check against the liveness endpoint
# (same block identity already had; busybox wget ships with alpine).
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1

CMD ["sh", "-c", "node scripts/check-env.mjs && node server.js"]
