# ---- builder: install all deps, build server (tsc) + dashboard (vite) ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install workspace deps first (better layer caching).
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm install

# Build.
COPY tsconfig.base.json ./
COPY server ./server
COPY web ./web
COPY config ./config
RUN npm run build

# ---- runner: slim image running the compiled gateway ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

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
