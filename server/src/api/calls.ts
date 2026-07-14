import { type SQL, and, desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client.js';
import { mcpServers, toolCalls, users } from '../db/schema.js';

export const callsRouter = Router();

/** Recent tool calls with user + server names — feeds the Recent Calls table. */
callsRouter.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  const filters: SQL[] = [];
  if (typeof req.query.tool === 'string') filters.push(eq(toolCalls.toolName, req.query.tool));
  if (typeof req.query.serverId === 'string') filters.push(eq(toolCalls.serverId, req.query.serverId));
  if (typeof req.query.userId === 'string') filters.push(eq(toolCalls.userId, req.query.userId));
  if (typeof req.query.status === 'string') filters.push(eq(toolCalls.status, req.query.status));

  const rows = await db
    .select({
      id: toolCalls.id,
      createdAt: toolCalls.createdAt,
      toolName: toolCalls.toolName,
      status: toolCalls.status,
      latencyMs: toolCalls.latencyMs,
      arguments: toolCalls.arguments,
      argsRedacted: toolCalls.argsRedacted,
      resultPreview: toolCalls.resultPreview,
      errorMessage: toolCalls.errorMessage,
      sessionId: toolCalls.sessionId,
      userExternalId: users.externalId,
      serverSlug: mcpServers.slug,
    })
    .from(toolCalls)
    .leftJoin(users, eq(users.id, toolCalls.userId))
    .leftJoin(mcpServers, eq(mcpServers.id, toolCalls.serverId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(toolCalls.createdAt))
    .limit(limit);

  res.json(rows);
});
