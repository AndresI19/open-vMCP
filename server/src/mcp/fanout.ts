import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ServerRow } from '../registry/index.js';
import { UPSTREAM_TIMEOUT_MS, connectUpstream, withTimeout } from './upstream.js';

/** A per-upstream failure, tagged with the server it came from. */
export interface FanOutError {
  slug: string;
  error: string;
}

/**
 * Fan a per-server async projection across `servers` in parallel — the shared skeleton behind the
 * aggregate catalog and the dashboard's all-tools view. Each upstream is opened (with a connect
 * timeout) and closed per call; a slow or unreachable one lands in `errors` instead of failing the
 * whole fan-out. The caller supplies only the projection, so the connect/close/isolate-failures
 * plumbing lives in one place.
 */
export async function fanOutServers<T>(
  servers: ServerRow[],
  project: (server: ServerRow, upstream: Client) => Promise<T[]>,
  bearer?: string,
): Promise<{ items: T[]; errors: FanOutError[] }> {
  const settled = await Promise.allSettled(
    servers.map(async (s) => {
      const upstream = await withTimeout(
        connectUpstream(s, bearer),
        UPSTREAM_TIMEOUT_MS,
        `${s.slug} connect`,
      );
      try {
        return await project(s, upstream);
      } finally {
        await upstream.close().catch(() => {});
      }
    }),
  );

  const items: T[] = [];
  const errors: FanOutError[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value);
    else errors.push({ slug: servers[i].slug, error: String(r.reason?.message ?? r.reason) });
  });

  return { items, errors };
}
