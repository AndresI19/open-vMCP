#!/usr/bin/env bash
# Postgres helper for environments without the `docker compose` plugin.
# Usage: scripts/db.sh {up|down|logs|psql}   (Linux: run `colima start` first)
set -euo pipefail
NAME=vmcp-db
case "${1:-up}" in
  up)
    docker run -d --name "$NAME" \
      -e POSTGRES_USER=vmcp -e POSTGRES_PASSWORD=vmcp -e POSTGRES_DB=vmcp \
      -p 5433:5432 -v vmcp_pgdata:/var/lib/postgresql/data \
      postgres:16
    ;;
  down) docker rm -f "$NAME" ;;
  logs) docker logs -f "$NAME" ;;
  psql) docker exec -it "$NAME" psql -U vmcp -d vmcp ;;
  *) echo "usage: $0 {up|down|logs|psql}"; exit 1 ;;
esac
