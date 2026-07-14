import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ServerRow } from '../registry/index.js';
import { disabledToolNames } from '../registry/tools.js';
import { recordToolCall } from './telemetry.js';

export interface ProxyContext {
  server: ServerRow;
  upstream: Client;
  externalUserId: string | null;
  /** Lazily read the downstream session id (assigned after initialize). */
  sessionId: () => string | null;
}

/** Pull a short text preview out of a CallToolResult for the dashboard. */
export function previewText(result: CallToolResult): string | undefined {
  const content = result.content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('\n');
  if (!text) return undefined;
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
}

/**
 * Build the downstream MCP Server (the face Claude talks to) for one upstream.
 * Two handlers ARE the passthrough; the callTool wrapper is the telemetry seam.
 */
export function buildProxyServer(ctx: ProxyContext): Server {
  const server = new Server(
    { name: `vmcp:${ctx.server.slug}`, version: '0.1.0' },
    // listChanged: per-tool policy can flip while a session is open — see sessions.ts.
    { capabilities: { tools: { listChanged: true } } },
  );

  // tools/list → ask upstream, drop any tools disabled by gateway policy.
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const listed = await ctx.upstream.listTools();
    const disabled = await disabledToolNames(ctx.server.id);
    const tools = listed.tools.filter((t) => !disabled.has(t.name));
    console.log(
      `[tools/list] ${ctx.server.slug} → ${tools.length}/${listed.tools.length} tools ` +
        `(user=${ctx.externalUserId ?? '-'})`,
    );
    return { ...listed, tools };
  });

  // tools/call → tap, forward, tap result, return verbatim.
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const toolName = req.params.name;
    const args = req.params.arguments ?? {};
    const requestedAt = new Date();
    const start = performance.now();

    // Gateway policy: refuse disabled tools before touching the upstream.
    const disabled = await disabledToolNames(ctx.server.id);
    if (disabled.has(toolName)) {
      await recordToolCall({
        serverId: ctx.server.id,
        externalUserId: ctx.externalUserId,
        sessionId: ctx.sessionId(),
        toolName,
        args,
        status: 'blocked',
        errorMessage: 'tool disabled by gateway policy',
        latencyMs: 0,
        requestedAt,
        respondedAt: new Date(),
      });
      console.log(
        `[tools/call] ${ctx.server.slug}/${toolName} user=${ctx.externalUserId ?? '-'} status=blocked`,
      );
      return {
        content: [{ type: 'text', text: `Tool "${toolName}" is disabled by the gateway.` }],
        isError: true,
      };
    }

    try {
      const result = (await ctx.upstream.callTool({
        name: toolName,
        arguments: args,
      })) as CallToolResult;
      const latencyMs = Math.round(performance.now() - start);
      const isError = result.isError === true;
      const preview = previewText(result);

      await recordToolCall({
        serverId: ctx.server.id,
        externalUserId: ctx.externalUserId,
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
        `[tools/call] ${ctx.server.slug}/${toolName} user=${ctx.externalUserId ?? '-'} ` +
          `status=${isError ? 'error' : 'ok'} ${latencyMs}ms`,
      );
      return result;
    } catch (err) {
      const latencyMs = Math.round(performance.now() - start);
      await recordToolCall({
        serverId: ctx.server.id,
        externalUserId: ctx.externalUserId,
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
        `[tools/call] ${ctx.server.slug}/${toolName} user=${ctx.externalUserId ?? '-'} ` +
          `status=error ${latencyMs}ms (${err instanceof Error ? err.message : String(err)})`,
      );
      throw err;
    }
  });

  return server;
}
