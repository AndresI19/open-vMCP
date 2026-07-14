import { eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client.js';
import { toolCalls, users } from '../db/schema.js';

export const usersRouter = Router();

/** Users seen so far, with their call counts — feeds the Users table. */
usersRouter.get('/', async (_req, res) => {
  const rows = await db
    .select({
      id: users.id,
      externalId: users.externalId,
      displayName: users.displayName,
      firstSeen: users.firstSeen,
      lastSeen: users.lastSeen,
      calls: sql<number>`count(${toolCalls.id})`,
    })
    .from(users)
    .leftJoin(toolCalls, eq(toolCalls.userId, users.id))
    .groupBy(users.id)
    .orderBy(sql`count(${toolCalls.id}) desc`);

  res.json(rows.map((r) => ({ ...r, calls: Number(r.calls) })));
});
