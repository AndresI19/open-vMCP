# CLAUDE.md — open-vMCP

Guidance for Claude Code when working in this repo.

## What this is

A **virtual MCP gateway**: one HTTP endpoint in front of many upstream MCP servers, with per-server
and per-tool policy, tool-call telemetry, and a Carbon dashboard. It is an MCP *server* to its
clients and an MCP *client* to each upstream.

npm workspaces: `server/` (Express 5 + MCP SDK + Drizzle/Postgres) and `web/` (React 18 + Vite +
Carbon).

**Platform context:** dashboard at `/vmcp/`, MCP endpoint at `/mcp`. See
`../platform-orchestration/ARCHITECTURE.md`.

## Commands

```bash
npm install
npm run dev            # server, tsx watch          (port 8001)
npm run dev:web        # dashboard, vite            (port 5173, proxies API to :8001)
npm run build          # tsc (server) + vite build (web)
npm start              # node dist/index.js
npm test               # vitest, both workspaces    (21 tests, 3 files)
npm run db:up          # postgres:16 via docker     — HOST PORT 5433, not 5432
npm run db:migrate     # drizzle
npm run db:seed        # upserts config/servers.seed.json
npm run e2e            # smoke script; needs a live gateway + upstream
```

**No linter, no separate typecheck script.** Typechecking only happens via `npm run build`.

## Architecture you need to hold in your head

**The gateway is an SSE ↔ Streamable-HTTP adapter, and that is a feature.**

- **Downstream** (client → gateway): **Streamable HTTP only.** There is no SSE server endpoint.
- **Upstream** (gateway → server): `sse` *or* `streamable-http`, per registry row. `stdio` is
  rejected — only hosted transports are allowed.

So `rs-mcp-server` (which speaks **only** SSE) is reachable from a modern Streamable-HTTP-only client
*through this gateway* and not otherwise.

**Two endpoint families, and tool names differ between them:**

| Endpoint | Tools | Notes |
| --- | --- | --- |
| `POST /mcp` (aggregate) | **prefixed**: `rs-mcp__search_wiki` (`NS = "__"`) | Fans `tools/list` out to every visible server in parallel; a slow upstream lands in `errors[]` instead of failing the listing. Opens/closes upstream connections per request. |
| `POST /mcp/:slug` | **unprefixed**: `search_wiki` | 1:1 passthrough. Holds one upstream client for the session. |

`resolveQualified` matches against the known slug list (longest wins) rather than splitting on `__`,
so upstream tools whose own names contain `__` still resolve.

## Auth — understand exactly how weak this is

`config/auth.json` + `server/src/auth/`. The bearer token is **base64url-decoded and NOT verified.**
Any JWT-shaped (or bare base64url-JSON) token is accepted; the `user` claim becomes the user id.

- `"verify": false` in the config, and **setting it to `true` changes nothing** — no verification
  code exists. `secret`/`jwksUri` are in the schema but unused.
- `/mcp/:slug` requires a token (401 without). `/mcp` (aggregate) deliberately allows anonymous
  `tools/list`, but `tools/call` refuses without an identity.
- `GET /vmcp/auth/mock-token?user=<id>` mints an unsigned token.

**The whole `/vmcp/api` data API is unauthenticated — including its writes** (register a server,
delete one, toggle a tool). In the platform, the *public* dashboard is made read-only by **nginx**
(`limit_except GET HEAD OPTIONS`), not by this app. That is a routing-layer control: bypass nginx and
the writes are wide open.

## Database

Postgres via Drizzle. `tool_calls` is the telemetry table — **one row per proxied `tools/call`**,
written by `recordToolCall`, which swallows its own errors so telemetry can never break a call.
`status` is `ok | error | blocked`; **`blocked` is a policy refusal, not an error**, and the stats
endpoints count only `error`.

Seeding: `config/servers.seed.json`, upserted **on every boot** by the Docker entrypoint (migrate →
seed → serve). `SEED_URL_<SLUG>` env vars override a seed URL per slug — slug `rs-mcp` →
`SEED_URL_RS_MCP`. That is how the cluster points it at `http://rs-mcp-server:8000/sse`.

**The RBAC seam is `visibleServers(userId)`** in `server/src/registry/index.ts`. It currently ignores
its argument and returns all enabled servers. The `user_server_access` table exists for the join and
is never read. If you implement RBAC, do it there — every routing and listing path already goes
through it. Note the documented constraint: "not permitted" must be **indistinguishable** from "does
not exist", or the API becomes an enumeration oracle.

## Environment

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | 8001 | |
| `DATABASE_URL` | — | required |
| `SEED_URL_<SLUG>` | — | per-slug seed URL override |
| `HOME_URL` | `/` | the dashboard's "← Home" link; served in `/vmcp/config.json` |
| `VMCP_API_BASE` | `""` | where the SPA sends API calls; served in `/vmcp/config.json` |
| `CORS_ORIGINS` | `""` | comma-separated allow-list |
| `REDACT_ARGS` | on | redaction is ON unless literally `"false"` |
| `CONFIG_DIR` | `config` | |

`HOME_URL`, `VMCP_API_BASE`, `CORS_ORIGINS` and `SEED_URL_*` are **not** in `.env.example` — that
file is incomplete.

`/vmcp/config.json` is fetched by the SPA **before first render**, which is what lets one image serve
both the local cluster (same-origin) and the split-origin public deploy with no rebuild.

## Gotchas

- **The README and DEMO.md are stale on API paths.** They show `localhost:8001/api/servers` and
  `/auth/mock-token`. The real paths moved under `/vmcp/`: `/vmcp/api/servers`,
  `/vmcp/auth/mock-token`, dashboard at `/vmcp/`. Only `/mcp*` and `/health` remain at the root.
- **Single-replica only.** MCP sessions live in an in-process `Map`, so `listChanged` broadcasts
  cannot cross replicas. Do not scale this Deployment.
- The aggregate `tools/list` and `GET /vmcp/api/tools` open a **fresh connection to every registered
  upstream on each request** (15s timeouts), and the dashboard polls every 5s. It is chatty.
- `loadAuthConfig()` memoizes at module level — editing `config/auth.json` needs a restart.
- Postgres dev host port is **5433**.
- `PATCH /vmcp/api/servers` (no id) is the all-servers master switch, declared before `/:id` so the
  param route doesn't swallow it.
- `POST /vmcp/api/servers` maps *any* insert failure to a 409 "slug already exists", which can mask
  real DB errors.
- The `mcp_sessions` table exists in the schema and nothing ever writes to it.
