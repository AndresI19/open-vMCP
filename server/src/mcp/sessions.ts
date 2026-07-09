import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

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
 * sessionId → live downstream session.
 *
 * Process-local: a toggle handled by one gateway replica cannot notify sessions held by
 * another. Single-replica only. Bridging replicas means moving this to Postgres
 * LISTEN/NOTIFY (or Redis pub/sub) and having each replica notify its own sessions.
 */
export const sessions = new Map<string, Session>();

/**
 * Tell live clients their tool catalog moved, so they re-issue tools/list instead of
 * running on a snapshot taken at connect time.
 *
 * Aggregate sessions (`slug === null`) fan out across every upstream, so any change
 * reaches them. A per-slug proxy session only cares about its own server — unless
 * `slug` is omitted, meaning "every server changed" (the dashboard master switch).
 *
 * Notification is best-effort: a client with no open GET stream, or one that closed
 * mid-write, must not fail the API request that triggered the broadcast.
 */
export async function broadcastToolListChanged(slug?: string): Promise<number> {
  const targets = [...sessions.values()].filter(
    (s) => s.slug === null || slug === undefined || s.slug === slug,
  );

  const settled = await Promise.allSettled(
    targets.map((s) => s.server.sendToolListChanged()),
  );

  const delivered = settled.filter((r) => r.status === "fulfilled").length;
  for (const r of settled) {
    if (r.status === "rejected") {
      console.warn(`[tools/list_changed] delivery failed: ${String(r.reason?.message ?? r.reason)}`);
    }
  }
  console.log(
    `[tools/list_changed] ${slug ?? "*"} → notified ${delivered}/${targets.length} sessions`,
  );
  return delivered;
}
