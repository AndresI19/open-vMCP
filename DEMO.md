# vMCP Gateway — containerized demo

Everything runs in Docker (under Colima). Claude reaches RuneScape tools **only** through the
gateway, which logs every call to Postgres and streams it to the dashboard.

```
Claude Code ──HTTP :8001──▶ open-vmcp ──SSE──▶ rs-mcp-server ──▶ RS/OSRS public APIs
   (rs-vmcp)                     │ Bearer→user, telemetry
                                 └──▶ vmcp-db (Postgres)
```

## What's running

```bash
docker ps --format '  {{.Names}}  {{.Image}}  {{.Ports}}'
#   open-vmcp    open-vmcp:dev    0.0.0.0:8001->8001/tcp
#   rs-mcp-server   rs-mcp-server:dev   0.0.0.0:8000->8000/tcp
#   vmcp-db         postgres:16         0.0.0.0:5433->5432/tcp
```
All three share the `vmcp-net` network; the gateway reaches RS as `rs-mcp-server:8000` and
Postgres as `vmcp-db:5432` (the `rs-mcp` registry row was seeded to the container DNS name).

## Three surfaces to watch

1. **Gateway log window** (ptyxis): `docker logs -f open-vmcp` — shows `[tools/list]` and
   `[tools/call] <server>/<tool> user=<id> status=… <ms>` per call.
2. **RS-MCP log window** (ptyxis): `docker logs -f rs-mcp-server` — the upstream server executing the
   proxied tool calls (shows `tool_call_end`, cache hits, and the real upstream API fetches).
3. **Dashboard**: <http://localhost:8001/vmcp/> — Overview, Tool Usage, Recent Calls (auto-refreshes).

## Restart the session, then approve

The gateway is registered as **`rs-vmcp`** in `.mcp.json` but is **pending approval**. After you
restart Claude Code here:

1. Approve `rs-vmcp` when prompted (project MCP server approval).
2. Confirm: `claude mcp list` → `rs-vmcp … ✔ Connected`.

The agent will then have the RS tools namespaced as `mcp__rs-vmcp__<tool>`, each attributed to
user **andres** (the bearer baked into `.mcp.json`).

## Demo flow

### 1. List all tools
> "List all the tools available from rs-vmcp."

Watch the gateway log: `[tools/list] rs-mcp → 17 tools (user=andres)`.

### 2. Run the test cases

Ask for each; the agent calls the matching tool through the gateway. After each, watch a
`[tools/call]` line appear in the gateway log, a request in the RS log, and a new row on the
dashboard's **Recent Calls**.

| # | Ask the agent | Tool → arguments |
|---|---|---|
| 1 | "What's the OSRS wiki say about Dragon Slayer II?" | `search_wiki {query:"Dragon Slayer II", game:"osrs"}` |
| 2 | "GE price of a Twisted bow (OSRS)?" | `get_item_price {item_name:"Twisted bow", game:"osrs"}` |
| 3 | "Show OSRS hiscores for player Lynx Titan." | `get_player_stats {username:"Lynx Titan", game:"osrs"}` |
| 4 | "Combat stats for Vorkath (OSRS)?" | `get_monster_info {monster_name:"Vorkath", game:"osrs"}` |
| 5 | "Requirements and rewards for the quest Monkey Madness II?" | `get_quest_info {quest_name:"Monkey Madness II", game:"osrs"}` |
| 6 | "What drops a Dragon warhammer in OSRS?" | `get_item_drop_sources {item_name:"Dragon warhammer", game:"osrs"}` |
| 7 | "Solve this OSRS anagram clue: 'AN EARL'." | `solve_clue {clue_text:"AN EARL", game:"osrs", clue_format:"anagram"}` |

### 3. Confirm end-to-end

```bash
curl -s localhost:8001/vmcp/api/stats/overview            # totals climbed
curl -s "localhost:8001/vmcp/api/calls?limit=8"          # your calls, user=andres, server=rs-mcp
```

## Handy commands

```bash
# logs
docker logs -f open-vmcp
docker logs -f rs-mcp-server

# restart just the gateway (after a rebuild)
docker rm -f open-vmcp && docker build -t open-vmcp:dev . && \
  docker run -d --name open-vmcp --network vmcp-net -p 8001:8001 \
    -e DATABASE_URL=postgres://vmcp:vmcp@vmcp-db:5432/vmcp \
    -e SEED_URL_RS_MCP=http://rs-mcp-server:8000/sse -e PORT=8001 open-vmcp:dev

# restart RS (run its image with uvicorn straight to stdout — see note below)
docker rm -f rs-mcp-server && \
  docker run -d --name rs-mcp-server --network vmcp-net -p 8000:8000 \
    --entrypoint /opt/venv/bin/python rs-mcp-server:dev \
    -m uvicorn rs_mcp_server.server:web --host 0.0.0.0 --port 8000

# tear down (keeps the Postgres volume)
docker rm -f open-vmcp rs-mcp-server vmcp-db
```

> **RS logging note:** the `rs-mcp-server` image's normal start script pipes logs through
> `rotatelogs`, which isn't installed in the image — so its logs would be lost. To get live RS
> logs for the demo, RS is run with its entrypoint overridden to launch uvicorn directly (stdout →
> `docker logs`). The proper fix belongs in the rs-mcp-server repo (add `apache2-utils`/rotatelogs
> to its Dockerfile).
