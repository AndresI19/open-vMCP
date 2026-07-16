import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { mcpServers } from '../db/schema.js';

export type ServerRow = typeof mcpServers.$inferSelect;

/**
 * THE single access-control seam.
 *
 * v1 open policy: every user sees all ENABLED servers. When RBAC lands, this is the
 * only function that changes — it filters by userId against a per-user access grant
 * (the join table is deferred until then). Both tools/list and the /mcp/:slug guard
 * route through here, so authorization has exactly one home.
 *
 * This currently conflates two reasons a server is absent: globally disabled, and (once
 * RBAC lands) not permitted for this user. Callers that turn absence into an error
 * message MUST keep them apart. "Disabled" is safe to state plainly; "not permitted"
 * must stay indistinguishable from "does not exist", or the error becomes an
 * enumeration oracle for servers the caller may not know about. See allServers().
 */
export async function visibleServers(_userId: string | null): Promise<ServerRow[]> {
  return db.select().from(mcpServers).where(eq(mcpServers.enabled, true));
}

/**
 * Every registered server, visibility ignored.
 *
 * Only for telling "disabled" apart from "unknown" when explaining a refused call.
 * Never route or list from this — that would bypass the seam above.
 */
export async function allServers(): Promise<ServerRow[]> {
  return db.select().from(mcpServers);
}

/** Resolve a slug to a server the given user is allowed to see, or null. */
export async function findVisibleServer(userId: string | null, slug: string): Promise<ServerRow | null> {
  const servers = await visibleServers(userId);
  return servers.find((s) => s.slug === slug) ?? null;
}
