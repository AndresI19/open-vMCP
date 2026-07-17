import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { mcpServers } from '../db/schema.js';

export type ServerRow = typeof mcpServers.$inferSelect;

/**
 * THE single access-control seam. v1 open policy: every user sees all ENABLED servers. RBAC changes
 * only this function (filter by userId against a per-user grant; join table deferred until then).
 * Both tools/list and the /mcp/:slug guard route through here, so authorization has one home.
 *
 * It conflates two reasons a server is absent: globally disabled, and (once RBAC lands) not permitted.
 * Callers turning absence into an error MUST keep them apart: "disabled" is safe to state, but "not
 * permitted" must stay indistinguishable from "does not exist" or the error is an enumeration oracle.
 */
export async function visibleServers(_userId: string | null): Promise<ServerRow[]> {
  return db.select().from(mcpServers).where(eq(mcpServers.enabled, true));
}

/**
 * Every registered server, visibility ignored — only for telling "disabled" apart from "unknown" when
 * explaining a refused call. Never route or list from this; that bypasses the seam above.
 */
export async function allServers(): Promise<ServerRow[]> {
  return db.select().from(mcpServers);
}

/** Resolve a slug to a server the given user is allowed to see, or null. */
export async function findVisibleServer(userId: string | null, slug: string): Promise<ServerRow | null> {
  const servers = await visibleServers(userId);
  return servers.find((s) => s.slug === slug) ?? null;
}
