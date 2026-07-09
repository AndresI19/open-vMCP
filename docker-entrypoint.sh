#!/bin/sh
# Apply migrations + seed the registry, then start the gateway. All three read
# DATABASE_URL / SEED_URL_* from the container environment.
set -e
echo "[entrypoint] applying migrations..."
node server/dist/db/migrate.js
echo "[entrypoint] seeding registry..."
node server/dist/db/seed.js
echo "[entrypoint] starting gateway on :${PORT:-8001}..."
exec node server/dist/index.js
