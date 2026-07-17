import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { toolSettings } from '../db/schema.js';

/** Names of tools explicitly disabled for a server (absence of a row = enabled). */
export async function disabledToolNames(serverId: string): Promise<Set<string>> {
  const rows = await db
    .select({ name: toolSettings.toolName })
    .from(toolSettings)
    .where(and(eq(toolSettings.serverId, serverId), eq(toolSettings.enabled, false)));
  return new Set(rows.map((r) => r.name));
}

/** Full name → enabled map for a server (only tools with an explicit setting). */
export async function toolSettingsMap(serverId: string): Promise<Map<string, boolean>> {
  const rows = await db.select().from(toolSettings).where(eq(toolSettings.serverId, serverId));
  return new Map(rows.map((r) => [r.toolName, r.enabled]));
}

/** Upsert a tool's enabled flag. */
export async function setToolEnabled(serverId: string, toolName: string, enabled: boolean): Promise<void> {
  await setToolsEnabled(serverId, [toolName], enabled);
}

/**
 * Upsert many tools' enabled flags in one statement — backs the "enable all" switch as a single
 * atomic write, so a bulk toggle can't land half-applied.
 */
export async function setToolsEnabled(
  serverId: string,
  toolNames: string[],
  enabled: boolean,
): Promise<number> {
  if (toolNames.length === 0) return 0;
  await db
    .insert(toolSettings)
    .values(toolNames.map((toolName) => ({ serverId, toolName, enabled })))
    .onConflictDoUpdate({
      target: [toolSettings.serverId, toolSettings.toolName],
      set: { enabled, updatedAt: sql`now()` },
    });
  return toolNames.length;
}
