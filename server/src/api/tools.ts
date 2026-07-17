import { Router } from 'express';
import { db } from '../db/client.js';
import { mcpServers } from '../db/schema.js';
import { fanOutServers } from '../mcp/fanout.js';
import { UPSTREAM_TIMEOUT_MS, withTimeout } from '../mcp/upstream.js';
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

  const { items: tools, errors } = await fanOutServers(servers, async (s, upstream) => {
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
  });

  res.json({ tools, errors });
});
