import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { identityRequired } from '../auth/middleware.js';
import { type ServerRow, allServers, visibleServers } from '../registry/index.js';
import { disabledToolNames } from '../registry/tools.js';
import { previewText } from './proxy.js';
import { recordToolCall } from './telemetry.js';
import { connectUpstream, withTimeout } from './upstream.js';

/**
 * Separator between a server slug and the upstream tool name in the aggregate
 * namespace: `rs-mcp__search_wiki`. Two upstreams may both expose a `search`, so the
 * flattened catalog has to qualify every name.
 */
export const NS = '__';

const UPSTREAM_TIMEOUT_MS = 15_000;

export interface AggregateTool extends Tool {
  /** Which upstream this tool came from, before the name was qualified. */
  serverSlug: string;
}

export interface AggregateContext {
  userId: string | null;
  bearer?: string;
  /** Lazily read the downstream session id (assigned after initialize). */
  sessionId: () => string | null;
}

export interface CollectedTools {
  tools: AggregateTool[];
  errors: { slug: string; error: string }[];
}

/**
 * Fan tools/list out across every server visible to `userId` and flatten the results
 * into one namespaced catalog. Upstreams are queried in parallel and each is opened and
 * closed per request — a slow or unreachable server lands in `errors` instead of
 * failing the whole listing.
 *
 * Visibility routes through visibleServers(), the single access-control seam, so when
 * RBAC lands an anonymous caller's catalog narrows without touching this file.
 */
export async function collectTools(userId: string | null, bearer?: string): Promise<CollectedTools> {
  const servers = await visibleServers(userId);

  const settled = await Promise.allSettled(
    servers.map(async (s) => {
      const upstream = await withTimeout(
        connectUpstream(s, bearer),
        UPSTREAM_TIMEOUT_MS,
        `${s.slug} connect`,
      );
      try {
        const listed = await withTimeout(upstream.listTools(), UPSTREAM_TIMEOUT_MS, `${s.slug} tools/list`);
        const disabled = await disabledToolNames(s.id);
        return listed.tools
          .filter((t) => !disabled.has(t.name))
          .map((t) => ({ ...t, name: `${s.slug}${NS}${t.name}`, serverSlug: s.slug }));
      } finally {
        await upstream.close().catch(() => {});
      }
    }),
  );

  const tools: AggregateTool[] = [];
  const errors: { slug: string; error: string }[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') tools.push(...r.value);
    else errors.push({ slug: servers[i].slug, error: String(r.reason?.message ?? r.reason) });
  });

  return { tools, errors };
}

/**
 * Map a qualified name back to its upstream. Matches against the known slug list rather
 * than splitting on NS, so an upstream tool whose own name contains "__" still resolves;
 * longest slug wins so one slug cannot shadow another it happens to prefix.
 */
function matchQualified(
  servers: ServerRow[],
  qualified: string,
): { server: ServerRow; toolName: string } | null {
  const match = servers
    .filter((s) => qualified.startsWith(`${s.slug}${NS}`))
    .sort((a, b) => b.slug.length - a.slug.length)[0];
  if (!match) return null;
  return { server: match, toolName: qualified.slice(match.slug.length + NS.length) };
}

export async function resolveQualified(
  userId: string | null,
  qualified: string,
): Promise<{ server: ServerRow; toolName: string } | null> {
  return matchQualified(await visibleServers(userId), qualified);
}

/**
 * Match against every registered server, visibility ignored — used only to explain why a
 * call was refused. Routing still goes through resolveQualified.
 */
async function resolveQualifiedUnfiltered(
  qualified: string,
): Promise<{ server: ServerRow; toolName: string } | null> {
  return matchQualified(await allServers(), qualified);
}

/**
 * Build the downstream MCP Server for the aggregate endpoint (`/mcp`, no slug), which
 * fronts every visible upstream at once.
 *
 * Reading the catalog is open; invoking a tool is not. tools/list answers anonymously so
 * a client can discover what the gateway fronts, while tools/call still honours
 * config/auth.json `onMissing` — otherwise the gateway would be an unauthenticated relay
 * to every upstream it knows about. Set `onMissing: "anonymous"` to open calls too.
 */
export function buildAggregateServer(ctx: AggregateContext): Server {
  const server = new Server(
    { name: 'vmcp:aggregate', version: '0.1.0' },
    // listChanged: the catalog is mutable at runtime (dashboard toggles), so clients are
    // told to re-list rather than run forever on their connect-time snapshot.
    { capabilities: { tools: { listChanged: true } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const { tools, errors } = await collectTools(ctx.userId, ctx.bearer);
    for (const e of errors) {
      console.warn(`[aggregate tools/list] skipped ${e.slug}: ${e.error}`);
    }
    console.log(
      `[aggregate tools/list] → ${tools.length} tools from ${new Set(tools.map((t) => t.serverSlug)).size} servers ` +
        `(user=${ctx.userId ?? '-'})`,
    );
    // serverSlug is gateway bookkeeping, not part of the MCP Tool shape.
    return { tools: tools.map(({ serverSlug: _slug, ...tool }) => tool) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const qualified = req.params.name;
    const args = req.params.arguments ?? {};
    const requestedAt = new Date();
    const start = performance.now();

    if (!ctx.userId && identityRequired()) {
      console.log(`[aggregate tools/call] ${qualified} user=- status=unauthorized`);
      return {
        content: [
          {
            type: 'text',
            text: `Calling "${qualified}" requires a bearer token. The aggregate catalog is readable anonymously, but tool execution is not. Mint a dev token at /auth/mock-token?user=<id> and send it as "Authorization: Bearer <token>".`,
          },
        ],
        isError: true,
      };
    }

    const resolved = await resolveQualified(ctx.userId, qualified);
    if (!resolved) {
      // A name can miss for two reasons, and the caller must be told them apart.
      // Disabled: the client is holding a stale catalog — say so, or it retries the name
      // as if it had typed it wrong. Not permitted (once RBAC lands) or genuinely absent:
      // both stay "unknown", so the error never confirms a server the caller can't see.
      const hidden = await resolveQualifiedUnfiltered(qualified);
      if (hidden && !hidden.server.enabled) {
        await recordToolCall({
          serverId: hidden.server.id,
          externalUserId: ctx.userId,
          sessionId: ctx.sessionId(),
          toolName: hidden.toolName,
          args,
          status: 'blocked',
          errorMessage: 'server disabled by gateway policy',
          latencyMs: 0,
          requestedAt,
          respondedAt: new Date(),
        });
        console.log(
          `[aggregate tools/call] ${hidden.server.slug}/${hidden.toolName} ` +
            `user=${ctx.userId ?? '-'} status=blocked (server disabled)`,
        );
        return {
          content: [
            {
              type: 'text',
              text: `Tool "${hidden.toolName}" is unavailable: server "${hidden.server.slug}" is disabled by the gateway. This is a policy block, not a bad tool name — re-listing tools will not return it.`,
            },
          ],
          isError: true,
        };
      }

      console.log(`[aggregate tools/call] ${qualified} user=${ctx.userId ?? '-'} status=unknown`);
      return {
        content: [
          {
            type: 'text',
            text: `Unknown tool "${qualified}". Expected a qualified name like "<server>${NS}<tool>".`,
          },
        ],
        isError: true,
      };
    }
    const { server: row, toolName } = resolved;

    // Gateway policy: refuse disabled tools before touching the upstream.
    const disabled = await disabledToolNames(row.id);
    if (disabled.has(toolName)) {
      await recordToolCall({
        serverId: row.id,
        externalUserId: ctx.userId,
        sessionId: ctx.sessionId(),
        toolName,
        args,
        status: 'blocked',
        errorMessage: 'tool disabled by gateway policy',
        latencyMs: 0,
        requestedAt,
        respondedAt: new Date(),
      });
      console.log(`[aggregate tools/call] ${row.slug}/${toolName} user=${ctx.userId ?? '-'} status=blocked`);
      return {
        content: [{ type: 'text', text: `Tool "${toolName}" is disabled by the gateway.` }],
        isError: true,
      };
    }

    let upstream: Awaited<ReturnType<typeof connectUpstream>>;
    try {
      upstream = await withTimeout(
        connectUpstream(row, ctx.bearer),
        UPSTREAM_TIMEOUT_MS,
        `${row.slug} connect`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recordToolCall({
        serverId: row.id,
        externalUserId: ctx.userId,
        sessionId: ctx.sessionId(),
        toolName,
        args,
        status: 'error',
        errorMessage: message,
        latencyMs: Math.round(performance.now() - start),
        requestedAt,
        respondedAt: new Date(),
      });
      console.log(
        `[aggregate tools/call] ${row.slug}/${toolName} user=${ctx.userId ?? '-'} status=error (${message})`,
      );
      return {
        content: [{ type: 'text', text: `Upstream connect failed: ${message}` }],
        isError: true,
      };
    }

    try {
      const result = (await upstream.callTool({
        name: toolName,
        arguments: args,
      })) as CallToolResult;
      const latencyMs = Math.round(performance.now() - start);
      const isError = result.isError === true;
      const preview = previewText(result);

      await recordToolCall({
        serverId: row.id,
        externalUserId: ctx.userId,
        sessionId: ctx.sessionId(),
        toolName,
        args,
        status: isError ? 'error' : 'ok',
        errorMessage: isError ? preview : undefined,
        latencyMs,
        requestedAt,
        respondedAt: new Date(),
        resultPreview: preview,
      });

      console.log(
        `[aggregate tools/call] ${row.slug}/${toolName} user=${ctx.userId ?? '-'} ` +
          `status=${isError ? 'error' : 'ok'} ${latencyMs}ms`,
      );
      return result;
    } catch (err) {
      const latencyMs = Math.round(performance.now() - start);
      await recordToolCall({
        serverId: row.id,
        externalUserId: ctx.userId,
        sessionId: ctx.sessionId(),
        toolName,
        args,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
        latencyMs,
        requestedAt,
        respondedAt: new Date(),
      });
      console.log(
        `[aggregate tools/call] ${row.slug}/${toolName} user=${ctx.userId ?? '-'} ` +
          `status=error ${latencyMs}ms (${err instanceof Error ? err.message : String(err)})`,
      );
      throw err;
    } finally {
      await upstream.close().catch(() => {});
    }
  });

  return server;
}
