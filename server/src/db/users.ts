import { sql } from 'drizzle-orm';
import { db } from './client.js';
import { users } from './schema.js';

export type UserRow = typeof users.$inferSelect;

/**
 * Upsert a user by the external id decoded from their token, bumping last_seen.
 * Returns the row (with the internal uuid used as a FK on tool_calls).
 */
export async function ensureUser(externalId: string, displayName?: string): Promise<UserRow> {
  const [row] = await db
    .insert(users)
    .values({ externalId, displayName: displayName ?? externalId })
    .onConflictDoUpdate({
      target: users.externalId,
      set: { lastSeen: sql`now()` },
    })
    .returning();
  return row;
}
