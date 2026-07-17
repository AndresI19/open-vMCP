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
npm test               # vitest, both workspaces    (8 test files)
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

## Auth

`config/auth.json` + `server/src/auth/`. Two modes, chosen by the `verify` flag:

- `verify: true` (the committed default) — `verifyToken` (`auth/verify.ts`) checks the JWT's RS256
  signature against the issuer's JWKS, plus issuer and audience. Algorithm is pinned to RS256, so a
  forged `alg: none` header cannot pick its own rules. A token it cannot vouch for becomes anonymous.
- `verify: false` — `decodeJwtPayload` base64url-decodes the payload WITHOUT checking the signature.
  Any JWT-shaped (or bare base64url-JSON) token is accepted. Local/mock only.

Either way, `claimMappings` maps the payload to `userId` (from `sub`) and a display name. The mocked
`/auth/mock-token` minter is **gone** — with verification on it could only mint tokens that get
rejected; real tokens now come from platform-auth.

- `/mcp/:slug` requires an identity (401 without). `/mcp` (aggregate) allows anonymous `tools/list`,
  but `tools/call` refuses without one.
- **`/vmcp/api` writes require an admin.** `requireAdminForWrites` (`auth/middleware.ts`) gates any
  non-GET on the signed `admin` claim (`req.isAdmin`); reads stay open. This REPLACED the old nginx
  `limit_except GET HEAD OPTIONS` stopgap — the check now lives in the app, on a signed claim, not in
  the routing layer.

## Database

Postgres via Drizzle. `tool_calls` is the telemetry table — **one row per proxied `tools/call`**,
written by `recordToolCall`, which swallows its own errors so telemetry can never break a call.
`status` is `ok | error | blocked`; **`blocked` is a policy refusal, not an error**, and the stats
endpoints count only `error`.

Seeding: `config/servers.seed.json`, upserted **on every boot** by the Docker entrypoint (migrate →
seed → serve). `SEED_URL_<SLUG>` env vars override a seed URL per slug — slug `rs-mcp` →
`SEED_URL_RS_MCP`. That is how the cluster points it at `http://rs-mcp-server:8000/sse`.

**The RBAC seam is `visibleServers(userId)`** in `server/src/registry/index.ts`. It currently ignores
its argument and returns all enabled servers (the v1 open policy). The old `user_server_access` join
table — present since day one but never read — has been removed; when you implement RBAC, add the
table back and consult it here, since every routing and listing path already goes through this seam.
Note the documented constraint: "not permitted" must be **indistinguishable** from "does not exist",
or the API becomes an enumeration oracle.

## Environment

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | 8001 | |
| `DATABASE_URL` | — | required |
| `SEED_URL_<SLUG>` | — | per-slug seed URL override |
| `HOME_URL` | `/` | the dashboard's "← Home" link; served in `/vmcp/config.json` |
| `VMCP_API_BASE` | `""` | where the SPA sends API calls; served in `/vmcp/config.json` |
| `MCP_PUBLIC_URL` | `""` | MCP endpoint the dashboard tells a client to use; served in `/vmcp/config.json` |
| `CORS_ORIGINS` | `""` | comma-separated allow-list |
| `REDACT_ARGS` | on | redaction is ON unless literally `"false"` |
| `CONFIG_DIR` | `config` | |

`HOME_URL`, `VMCP_API_BASE`, `MCP_PUBLIC_URL`, `CORS_ORIGINS` and `SEED_URL_*` are **not** in
`.env.example` — that file is incomplete.

`/vmcp/config.json` is fetched by the SPA **before first render**, which is what lets one image serve
both the local cluster (same-origin) and the split-origin public deploy with no rebuild.

## Gotchas

- **Path layout.** The dashboard, its data API, and `config.json` live under `/vmcp/`
  (`/vmcp/api/servers`, dashboard at `/vmcp/`). Only `/mcp*`, `/health` and `/version` are at the
  root — kept there so existing MCP client configs are unaffected by the dashboard's prefix.
- **`/version` reports the running image, not package.json.** It reads a `VERSION` file baked in by
  the Dockerfile, which `platform-orchestration/k8s/deploy.sh` stamps from this repo's latest git tag
  (suffixed `-snapshot` when the source differs from `main`). A dev checkout has no such file and
  reports `"snapshot"`. The platform home page reads it through its own `/api/versions` aggregate.
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
