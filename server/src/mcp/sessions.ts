import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export interface Session {
  transport: StreamableHTTPServerTransport;
  server: Server;
  /** The aggregate endpoint holds no long-lived upstream; it connects per call. */
  upstream: Client | null;
  /** null = the aggregate endpoint (`/mcp`), otherwise the single server it fronts. */
  slug: string | null;
  userId: string | null;
}

/**
 * sessionId → live downstream session. Process-local: a toggle on one replica can't notify sessions
 * on another, so single-replica only. Bridging replicas means Postgres LISTEN/NOTIFY (or Redis
 * pub/sub), each replica notifying its own sessions.
 */
export const sessions = new Map<string, Session>();

/**
 * Tell live clients their catalog moved, so they re-issue tools/list instead of running on a
 * connect-time snapshot. Aggregate sessions (`slug === null`) get every change; a per-slug session
 * gets only its own server's — unless `slug` is omitted, meaning "every server changed" (the master
 * switch). Best-effort: a client with no open GET stream must not fail the API request that fired it.
 */
export async function broadcastToolListChanged(slug?: string): Promise<number> {
  const targets = [...sessions.values()].filter(
    (s) => s.slug === null || slug === undefined || s.slug === slug,
  );

  const settled = await Promise.allSettled(targets.map((s) => s.server.sendToolListChanged()));

  const delivered = settled.filter((r) => r.status === 'fulfilled').length;
  for (const r of settled) {
    if (r.status === 'rejected') {
      console.warn(`[tools/list_changed] delivery failed: ${String(r.reason?.message ?? r.reason)}`);
    }
  }
  console.log(`[tools/list_changed] ${slug ?? '*'} → notified ${delivered}/${targets.length} sessions`);
  return delivered;
}
