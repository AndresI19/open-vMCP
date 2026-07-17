import { eq, sql } from 'drizzle-orm';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client.js';
import { mcpServers } from '../db/schema.js';
import { broadcastToolListChanged } from '../mcp/sessions.js';
import { connectUpstream } from '../mcp/upstream.js';
import { setToolEnabled, setToolsEnabled, toolSettingsMap } from '../registry/tools.js';

export const serversRouter = Router();

/**
 * Validate `req.body` against `schema`. On failure, answer a 400 with the flattened errors and
 * return null so the caller returns; on success, return the parsed data. Folds the safeParse→400
 * frame that every write here would otherwise repeat.
 */
function parseBody<T>(schema: z.ZodType<T>, req: Request, res: Response): T | null {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return null;
  }
  return parsed.data;
}

/** Slug for a server id, or null — needed to scope a broadcast to per-slug sessions. */
async function slugFor(id: string): Promise<string | null> {
  const [row] = await db.select({ slug: mcpServers.slug }).from(mcpServers).where(eq(mcpServers.id, id));
  return row?.slug ?? null;
}

/** Notify live sessions of a tool-list change scoped to one server's slug, if it still exists. */
async function broadcastForServer(id: string): Promise<void> {
  const slug = await slugFor(id);
  if (slug) await broadcastToolListChanged(slug);
}

// Hosted upstreams only — stdio/subprocess registration is disabled for now.
const baseSchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with dashes'),
  name: z.string().min(1),
  url: z.string().url(),
  transport: z.enum(['sse', 'streamable-http']).default('sse'),
  enabled: z.boolean().default(true),
  forwardAuth: z.boolean().default(false),
});

/** List every registered server (enabled or not) — the control-plane table. */
serversRouter.get('/', async (_req, res) => {
  const rows = await db.select().from(mcpServers).orderBy(mcpServers.createdAt);
  res.json(rows);
});

serversRouter.post('/', async (req, res) => {
  const data = parseBody(baseSchema, req, res);
  if (!data) return;
  try {
    const [row] = await db.insert(mcpServers).values(data).returning();
    await broadcastToolListChanged(row.slug);
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: `slug '${data.slug}' already exists` });
  }
});

/**
 * Enable or disable every registered server at once — the dashboard's master switch.
 * Declared before "/:id" so the bare path is not swallowed by the id parameter.
 */
serversRouter.patch('/', async (req, res) => {
  const data = parseBody(z.object({ enabled: z.boolean() }), req, res);
  if (!data) return;
  const rows = await db
    .update(mcpServers)
    .set({ enabled: data.enabled, updatedAt: sql`now()` })
    .returning({ id: mcpServers.id });
  // Every server moved; no slug scopes this.
  await broadcastToolListChanged();
  res.json({ ok: true, updated: rows.length });
});

serversRouter.patch('/:id', async (req, res) => {
  const data = parseBody(baseSchema.partial(), req, res);
  if (!data) return;
  const [row] = await db
    .update(mcpServers)
    .set({ ...data, updatedAt: sql`now()` })
    .where(eq(mcpServers.id, String(req.params.id)))
    .returning();
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  // A slug rename orphans sessions bound to the old slug, so widen the broadcast to everyone rather
  // than notifying only the new slug.
  await broadcastToolListChanged(data.slug === undefined ? row.slug : undefined);
  res.json(row);
});

serversRouter.delete('/:id', async (req, res) => {
  const [row] = await db
    .delete(mcpServers)
    .where(eq(mcpServers.id, String(req.params.id)))
    .returning();
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  await broadcastToolListChanged(row.slug);
  res.status(204).end();
});

/** Single server row (for the detail page header). */
serversRouter.get('/:id', async (req, res) => {
  const [row] = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.id, String(req.params.id)));
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(row);
});

/** Live tools + descriptions from the upstream, merged with per-tool enabled state. */
serversRouter.get('/:id/tools', async (req, res) => {
  const [row] = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.id, String(req.params.id)));
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  let upstream: Awaited<ReturnType<typeof connectUpstream>>;
  try {
    upstream = await connectUpstream(row);
  } catch (err) {
    res.status(502).json({ error: `upstream connect failed: ${(err as Error).message}` });
    return;
  }

  try {
    const listed = await upstream.listTools();
    const settings = await toolSettingsMap(row.id);
    const tools = listed.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema,
      enabled: settings.get(t.name) ?? true,
    }));
    res.json({ tools });
  } catch (err) {
    res.status(502).json({ error: `tools/list failed: ${(err as Error).message}` });
  } finally {
    await upstream.close().catch(() => {});
  }
});

/** Enable/disable many of a server's tools in one write — the per-server master switch. */
serversRouter.patch('/:id/tools', async (req, res) => {
  const data = parseBody(
    z.object({ enabled: z.boolean(), tools: z.array(z.string().min(1)).min(1) }),
    req,
    res,
  );
  if (!data) return;
  const id = String(req.params.id);
  const updated = await setToolsEnabled(id, data.tools, data.enabled);
  await broadcastForServer(id);
  res.json({ ok: true, updated });
});

/** Enable/disable a single tool for a server. */
serversRouter.patch('/:id/tools/:toolName', async (req, res) => {
  const data = parseBody(z.object({ enabled: z.boolean() }), req, res);
  if (!data) return;
  const id = String(req.params.id);
  await setToolEnabled(id, String(req.params.toolName), data.enabled);
  await broadcastForServer(id);
  res.json({ ok: true });
});
