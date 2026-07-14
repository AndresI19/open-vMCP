import { count, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client.js';
import { mcpServers, toolCalls } from '../db/schema.js';

export const statsRouter = Router();

/** Headline tiles for the Overview page. */
statsRouter.get('/overview', async (_req, res) => {
  const [{ total }] = await db.select({ total: count() }).from(toolCalls);
  const [{ errors }] = await db
    .select({ errors: count() })
    .from(toolCalls)
    .where(eq(toolCalls.status, 'error'));
  const [{ uniqueUsers }] = await db
    .select({ uniqueUsers: sql<number>`count(distinct ${toolCalls.userId})` })
    .from(toolCalls);
  const [{ activeServers }] = await db
    .select({ activeServers: count() })
    .from(mcpServers)
    .where(eq(mcpServers.enabled, true));

  const totalN = Number(total);
  const errorN = Number(errors);
  res.json({
    totalCalls: totalN,
    errorCount: errorN,
    errorRate: totalN ? errorN / totalN : 0,
    uniqueUsers: Number(uniqueUsers),
    activeServers: Number(activeServers),
  });
});

/** Calls grouped by tool, split ok/error — feeds the grouped bar chart. */
statsRouter.get('/by-tool', async (_req, res) => {
  const rows = await db
    .select({
      tool: toolCalls.toolName,
      total: count(),
      errors: sql<number>`count(*) filter (where ${toolCalls.status} = 'error')`,
    })
    .from(toolCalls)
    .groupBy(toolCalls.toolName)
    .orderBy(sql`count(*) desc`);

  res.json(
    rows.map((r) => {
      const total = Number(r.total);
      const errors = Number(r.errors);
      return { tool: r.tool, total, errors, ok: total - errors };
    }),
  );
});

/** Calls bucketed over time — feeds the line chart. */
statsRouter.get('/timeseries', async (req, res) => {
  const bucket = req.query.bucket === 'day' ? 'day' : 'hour';
  const rows = await db
    .select({
      ts: sql<string>`date_trunc(${bucket}, ${toolCalls.createdAt})`,
      total: count(),
    })
    .from(toolCalls)
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  res.json(rows.map((r) => ({ ts: r.ts, count: Number(r.total) })));
});
