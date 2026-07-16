import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ServerRow } from '../registry/index.js';

/** Only hosted (URL-addressable) upstream transports are permitted for now. */
export const HOSTED_TRANSPORTS = ['sse', 'streamable-http'] as const;

/** How long any single upstream operation (connect, tools/list, tools/call) may run before it is aborted. */
export const UPSTREAM_TIMEOUT_MS = 15_000;

/** Reject a hung upstream so one dead server can't stall a fan-out across all of them. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * Open an MCP client connection to an upstream server described by a registry row.
 * The gateway is the CLIENT here (facing the real MCP server). If the row opts in
 * to forwardAuth, the caller's bearer is passed through (the RS server ignores it).
 */
export async function connectUpstream(server: ServerRow, bearer?: string): Promise<Client> {
  const client = new Client({ name: 'open-vmcp', version: '0.1.0' }, { capabilities: {} });

  // Hosted transports only — stdio/subprocess upstreams are disabled for now.
  if (!(HOSTED_TRANSPORTS as readonly string[]).includes(server.transport)) {
    throw new Error(
      `upstream transport '${server.transport}' is disabled; register a hosted (sse/streamable-http) server`,
    );
  }
  if (!server.url) throw new Error(`${server.transport} server '${server.slug}' has no url`);

  const url = new URL(server.url);
  const headers: Record<string, string> = {};
  if (server.forwardAuth && bearer) headers.Authorization = `Bearer ${bearer}`;

  const transport: Transport =
    server.transport === 'streamable-http'
      ? new StreamableHTTPClientTransport(url, { requestInit: { headers } })
      : new SSEClientTransport(url, { requestInit: { headers } });

  await client.connect(transport);
  return client;
}
