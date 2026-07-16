import { Router } from 'express';
import { db } from '../db/client.js';
import { mcpServers } from '../db/schema.js';
import { UPSTREAM_TIMEOUT_MS, connectUpstream, withTimeout } from '../mcp/upstream.js';
import { toolSettingsMap } from '../registry/tools.js';

export const toolsRouter = Router();

/**
 * Aggregate every tool across ALL servers into one list, each tagged with its server
 * slug and the server's enabled state (so the UI can show disabled servers' tools as
 * disabled). Upstreams are queried in parallel; a slow/unreachable server is reported
 * in `errors` rather than failing the whole response.
 */
toolsRouter.get('/', async (_req, res) => {
  const servers = await db.select().from(mcpServers);

  const results = await Promise.allSettled(
    servers.map(async (s) => {
      const upstream = await withTimeout(connectUpstream(s), UPSTREAM_TIMEOUT_MS, `${s.slug} connect`);
      try {
        const listed = await withTimeout(upstream.listTools(), UPSTREAM_TIMEOUT_MS, `${s.slug} tools/list`);
        const settings = await toolSettingsMap(s.id);
        return listed.tools.map((t) => ({
          serverId: s.id,
          serverSlug: s.slug,
          serverEnabled: s.enabled,
          name: t.name,
          description: t.description ?? '',
          enabled: settings.get(t.name) ?? true,
        }));
      } finally {
        await upstream.close().catch(() => {});
      }
    }),
  );

  const tools: unknown[] = [];
  const errors: { slug: string; error: string }[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') tools.push(...r.value);
    else errors.push({ slug: servers[i].slug, error: String(r.reason?.message ?? r.reason) });
  });

  res.json({ tools, errors });
});
