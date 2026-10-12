# ---------- dependencies ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* .npmrc* ./
# Phase 9 note: devDependencies (typescript) MUST be present in the builder —
# Next.js needs the TS toolchain to translate tsconfig `paths` (@/* -> src/*)
# into webpack aliases during `next build`; without it `@/lib/security` fails.
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

# ---------- builder ----------
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- runner ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=4002 HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Phase 9 (item 5): fail the container at start if any required env var is missing.
COPY --from=builder --chown=nextjs:nodejs /app/scripts/check-env.mjs ./scripts/check-env.mjs

USER nextjs
EXPOSE 4002
# Audit lapse-3 fix: container health check against the liveness endpoint
# (same block identity already had; busybox wget ships with alpine).
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:4002/api/health || exit 1

CMD ["sh", "-c", "node scripts/check-env.mjs && node server.js"]
