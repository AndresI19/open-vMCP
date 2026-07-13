# ---- builder: install all deps, build server (tsc) + dashboard (vite), then drop dev deps ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install workspace deps first (better layer caching).
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm install

# Build, then prune to production dependencies. The runtime runs the COMPILED gateway
# (node server/dist/…) — it never needs tsc, vite, vitest or drizzle-kit — so those have no business
# shipping in the image. Migrations run from the compiled server/dist/db/migrate.js against the SQL in
# server/drizzle, using drizzle-ORM (a prod dep), not drizzle-KIT.
COPY tsconfig.base.json ./
COPY server ./server
COPY web ./web
COPY config ./config
RUN npm run build && npm prune --omit=dev

# ---- runner: apt-patched slim image, no npm, running the compiled gateway on prod deps only ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Patch the OS, then strip npm (the runtime only runs `node` via the entrypoint): both are pure CVE
# surface, and npm's bundled node_modules are a recurring source of HIGH/CRITICAL findings.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/drizzle ./server/drizzle
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/config ./config
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 8001
ENTRYPOINT ["./docker-entrypoint.sh"]
