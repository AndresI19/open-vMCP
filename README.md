# open-vMCP

A **virtual MCP gateway** you can read in an afternoon. One endpoint in front of every MCP server you
run, with per-server and per-tool policy, and a record of every call that crosses it.

The server is **~1,800 lines of TypeScript across 28 files**. That is the point. This is a proof of
concept and a reference implementation — small enough to read end to end, with each moving part in one
obvious place.

Claude connects to the portal instead of the upstream server. Every frame passes through verbatim, and
the gateway taps each `tools/call` to record telemetry to **Postgres**, attributed to a user id decoded
from a (mocked) bearer token. A **Carbon React** dashboard renders usage *and* manages which MCP servers
the gateway fronts.

## What this is not

Production MCP gateways exist and they are good. If you need one, use theirs:

| | |
|---|---|
| [docker/mcp-gateway](https://github.com/docker/mcp-gateway) | ships inside the Docker CLI |
| [microsoft/mcp-gateway](https://github.com/microsoft/mcp-gateway) | session-aware routing and lifecycle on Kubernetes |
| [TheLunarCompany/lunar](https://github.com/TheLunarCompany/lunar) | per-tool policy, per-consumer RBAC, audit logs, rate limiting |
| [AmoyLab/Unla](https://github.com/AmoyLab/Unla) | turns existing REST APIs into MCP servers |

`open-vMCP` does not try to out-feature any of them. Its RBAC is a documented *seam*, not an
implementation. Its identity is deliberately mocked. What it offers instead is a complete, working
vMCP whose every mechanism — aggregation, tool policy, telemetry, `listChanged`, session lifecycle —
is small enough to hold in your head.

Inspired by [MintMCP](https://www.mintmcp.com/).

## Architecture

```
Claude  (mcp cfg: type:http, url :8001/mcp/rs-mcp, Authorization: Bearer <mockJWT>)
  │  Streamable HTTP
  ▼
┌──────────── vMCP Gateway  (:8001, single Node process) ────────────┐
│  /mcp/:slug   auth → resolveIdentity(bearer) → userId              │
│               registry → visibleServers(userId).bySlug(slug)       │
│               SDK Server ⇄ SDK Client ─── SSE ──► upstream MCP     │
│                 tools/list → upstream.listTools()                  │
│                 tools/call → tap → upstream.callTool() → tap       │
│  /auth/mock-token?user=…   mint a mock bearer for testing          │
│  /api/*        stats · servers CRUD · users · calls                │
│  /*            the built Carbon dashboard                          │
│  Drizzle ─► Postgres :5433                                          │
└────────────────────────────────────────────────────────────────────┘
```

The upstream can speak **SSE** (what `rs-mcp-server` serves today) while Claude speaks modern
**Streamable HTTP** — the gateway is the adapter.

## Prerequisites

- Node 20+ and npm
- Docker (Linux: run `colima start` first) for Postgres
- An upstream MCP server. Either the real [`rs-mcp-server`](../rs-mcp-server) on `:8000`, or the
  bundled mock (`npm run mock-upstream`).

## Quickstart

```bash
npm install
cp .env.example .env

npm run db:up          # Postgres 16 on :5433 (uses scripts/db.sh; no compose plugin needed)
npm run db:generate    # generate the Drizzle migration (committed under server/drizzle)
npm run db:migrate     # apply it
npm run db:seed        # seed the registry from config/servers.seed.json (rs-mcp)

npm run build          # build the Carbon dashboard (web/dist)
npm run dev            # start the gateway on :8001 (serves the dashboard + MCP + API)
```

Open the dashboard at <http://localhost:8001>.

### Connect Claude

Mint a bearer token on the Overview page or via `GET /auth/mock-token?user=<id>`, then point an MCP
client at either endpoint.

The **aggregate** endpoint fronts every enabled upstream at once, namespacing tools as
`<server>__<tool>`:

```bash
claude mcp add --transport http vmcp http://localhost:8001/mcp \
  --header "Authorization: Bearer <token from /auth/mock-token>"
```

The **per-server** endpoint is a 1:1 passthrough to a single upstream:

```bash
claude mcp add --transport http rs-vmcp http://localhost:8001/mcp/rs-mcp \
  --header "Authorization: Bearer <token from /auth/mock-token>"
```

Ask a RuneScape question and watch the call appear on the dashboard. Disable a tool from the dashboard
and ask again — the call is refused before the upstream is contacted, and the refusal says so.

## Data-driven configuration

Two files under `config/` (a supplied file-set):

- **`auth.json`** — how to turn a bearer token into a user id. Fully mocked in v1
  (`verify:false` → decode only). `claimMappings[].from` is a dot-path into the token payload
  (e.g. `"user"` or `"user.id"`); `to` is where it lands internally (`userId`). Change the mapping,
  not the code. Flip `verify:true` and add `secret`/`jwksUri` later for real validation — same code path.
- **`servers.seed.json`** — seeds the DB-backed registry at `npm run db:seed`. After that the
  registry is live: add/enable/disable upstreams from the dashboard's **MCP Servers** page.

### Upstream transports

**Hosted upstreams only.** The gateway fronts servers reachable over a URL:

- **`sse`** / **`streamable-http`** — remote servers addressed by `url` (a real DNS host or localhost).

> stdio/subprocess upstreams (the `npx …` pattern) are **disabled for now** — registration is rejected
> at the API and the connect layer. Everything must run off a hosted server. (The `command`/`args`
> columns remain in the schema so this can be re-enabled later behind a flag.)

Register hosted servers from the dashboard's **MCP Servers** form, or via the API — including public
no-auth remote MCPs by DNS:

```bash
# DeepWiki — ask questions about any public GitHub repo (Streamable HTTP, no auth)
curl -XPOST localhost:8001/api/servers -H 'content-type: application/json' -d \
 '{"slug":"deepwiki","name":"DeepWiki","transport":"streamable-http","url":"https://mcp.deepwiki.com/mcp"}'

# Context7 — library/framework documentation (Streamable HTTP, no auth)
curl -XPOST localhost:8001/api/servers -H 'content-type: application/json' -d \
 '{"slug":"context7","name":"Context7","transport":"streamable-http","url":"https://mcp.context7.com/mcp"}'
```

Then exercise any of them through the gateway (lists tools; calls one if given):

```bash
npm run call -- deepwiki alice ask_question '{"repoName":"facebook/react","question":"How does reconciliation work?"}'
npm run call -- rs-mcp   bob   get_item_price '{"item_name":"Abyssal whip","game":"osrs"}'
```

## Verification

```bash
npm run test           # unit tests: identity claim-mapping + argument redaction
npm run e2e            # scripted MCP client → gateway → upstream, one live tool call
npm run populate       # varied calls across 2 users + an error, to fill the dashboard
```

`e2e`/`populate` need the gateway (`:8001`) and an upstream running. To demo without the Python
server: `npm run mock-upstream` (Streamable HTTP on `:8009`), then register it:

```bash
curl -XPOST localhost:8001/api/servers -H 'content-type: application/json' \
  -d '{"slug":"mock","name":"Mock","url":"http://localhost:8009/mcp","transport":"streamable-http"}'
```

## Project layout

```
config/          auth.json + servers.seed.json (data-driven config)
server/src/
  paths.ts env.ts        repo-root-relative path + .env loading
  config/load.ts         validate auth.json (zod)
  auth/identity.ts       resolveIdentity: decode token, walk dot-path → userId
  auth/middleware.ts     bearer → req.userId (401 on missing when configured)
  auth/mint.ts           mint a mock token matching the configured claim schema
  db/                    Drizzle schema, client, migrate, seed, users upsert
  registry/index.ts      visibleServers(userId) — the single RBAC seam
  registry/tools.ts      per-tool policy (absence of a row = enabled)
  mcp/upstream.ts        SDK Client factory (SSE / streamable-http)
  mcp/proxy.ts           per-slug SDK Server; tools/list + tools/call passthrough
  mcp/aggregate.ts       the `/mcp` endpoint: fan out tools/list, route tools/call
  mcp/sessions.ts        live sessions + broadcastToolListChanged()
  mcp/telemetry.ts       write tool_calls (+ redaction), never breaks the call
  mcp/router.ts          Streamable HTTP endpoints, one upstream client per session
  api/                   stats · servers · users · calls
  index.ts               express bootstrap (mcp + api + static dashboard)
web/src/                 Vite + @carbon/react + @carbon/charts-react dashboard
```

## Notes & roadmap

- **RBAC** (only certain servers visible to certain users) has its seam in place:
  `visibleServers(userId)` and the `user_server_access` table. v1 policy is open (all enabled
  servers visible to all users); RBAC changes only that one function. Note the constraint documented
  there: "disabled" may be stated plainly in an error, but "not permitted" must stay indistinguishable
  from "does not exist", or the error becomes an enumeration oracle.
- **Auth** is deliberately mocked. Nothing verifies the token signature yet — do not use as-is
  outside local development.
- **Notifications**: the gateway advertises `tools.listChanged` and pushes
  `notifications/tools/list_changed` to live sessions on every registry mutation. Delivery is
  best-effort — the MCP SDK drops a notification silently when a client holds no standalone SSE
  stream, so `broadcastToolListChanged` cannot currently distinguish "delivered" from "dropped".
  The call-time refusal is the guarantee; the notification is the optimization.
- **Sessions** are process-local (`mcp/sessions.ts`), so the gateway is single-replica. Bridging
  replicas means Postgres `LISTEN`/`NOTIFY`. An unrecognized session id returns **404**, per the MCP
  spec, so a client discards it and re-initializes rather than replaying a dead id forever.
```
