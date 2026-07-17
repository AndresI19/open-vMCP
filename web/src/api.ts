import { useCallback, useEffect, useState } from 'react';
import { authHeaders, isAdmin, isSignedIn } from './auth';
import { notify } from './notify';

export interface Overview {
  totalCalls: number;
  errorCount: number;
  errorRate: number;
  uniqueUsers: number;
  activeServers: number;
}
export interface ToolStat {
  tool: string;
  total: number;
  ok: number;
  errors: number;
}
export interface TimePoint {
  ts: string;
  count: number;
}
export interface ServerRow {
  id: string;
  slug: string;
  name: string;
  url: string | null;
  transport: string;
  command: string | null;
  args: string[] | null;
  enabled: boolean;
  forwardAuth: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface UserRow {
  id: string;
  externalId: string;
  displayName: string | null;
  firstSeen: string;
  lastSeen: string;
  calls: number;
}
export interface CallRow {
  id: string;
  createdAt: string;
  toolName: string;
  status: string;
  latencyMs: number | null;
  arguments: unknown;
  argsRedacted: boolean;
  resultPreview: string | null;
  errorMessage: string | null;
  sessionId: string | null;
  userExternalId: string | null;
  serverSlug: string | null;
}

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: unknown;
  enabled: boolean;
}

export interface AggTool {
  serverId: string;
  serverSlug: string;
  serverEnabled: boolean;
  name: string;
  description: string;
  enabled: boolean;
}

// Where the data API lives. Defaults to same-origin under the dashboard's serve prefix
// (import.meta.env.BASE_URL, e.g. '/vmcp/') — the local deploy. In production the API is a separate
// origin, overridden at RUNTIME from /vmcp/config.json (setApiBase, called before first render):
// runtime not build-time so one image runs both places — the hostname is a deploy concern.
let BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Point every subsequent API call at `base` (an absolute origin). Empty/undefined keeps the default. */
export function setApiBase(base: string | undefined): void {
  if (base) BASE = base.replace(/\/$/, '');
}

// The MCP endpoint advertised to clients on Overview. Same runtime-config reasoning as BASE: empty =
// same-origin, the deploy supplies the public host. NOT the in-cluster Service address — that
// resolves only for cluster members, and the client reading this runs outside the cluster.
let MCP = '';

export function setMcpUrl(url: string | undefined): void {
  if (url) MCP = url.replace(/\/$/, '');
}

/** The endpoint an external MCP client should connect to. Absolute in production, same-origin locally. */
export function mcpEndpoint(): string {
  return MCP || `${window.location.origin}/mcp`;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return (await r.json()) as T;
}
/**
 * Every MUTATION goes through here, attaching the bearer in one place. Reads deliberately don't carry
 * one — the server keeps reads open. Hiding controls from a non-admin is a courtesy; the defence is
 * the server, which 403s the write regardless.
 */
const send = async (path: string, init: RequestInit = {}): Promise<Response> => {
  // Short-circuit a write the caller can't make: the server 403s it regardless, so firing it (plus
  // the handler's refresh()) only buys a round-trip before the same "not allowed" toast. Answering
  // here keeps an unauthorized click INERT — a notification, no fetch, no re-render. The server is
  // still the lock; this is a courtesy for the person clicking.
  if (!isAdmin()) {
    notify(
      isSignedIn()
        ? {
            kind: 'error',
            title: 'Not allowed',
            subtitle: 'Changing the registry needs an admin. You are signed in without that role.',
          }
        : {
            kind: 'error',
            title: 'Sign in first',
            subtitle: 'Sign in (top-right) to make changes.',
          },
    );
    return new Response(null, { status: isSignedIn() ? 403 : 401 });
  }

  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(await authHeaders())) headers.set(k, v);
  const res = await fetch(BASE + path, { ...init, headers });

  // Defence in depth: a token that expired between render and click, or a claim the server no longer
  // honours, still surfaces here rather than failing silently.
  if (res.status === 403) {
    notify({
      kind: 'error',
      title: 'Not allowed',
      subtitle: 'Changing the registry needs an admin. You are signed in without that role.',
    });
  } else if (res.status === 401) {
    notify({
      kind: 'error',
      title: isSignedIn() ? 'Session expired' : 'Sign in first',
      subtitle: isSignedIn()
        ? 'Your token has expired — sign in again from the top-right.'
        : 'Sign in (top-right) to make changes.',
    });
  }
  return res;
};

export const api = {
  overview: () => get<Overview>('/api/stats/overview'),
  byTool: () => get<ToolStat[]>('/api/stats/by-tool'),
  timeseries: (bucket = 'hour') => get<TimePoint[]>(`/api/stats/timeseries?bucket=${bucket}`),
  servers: () => get<ServerRow[]>('/api/servers'),
  users: () => get<UserRow[]>('/api/users'),
  calls: (limit = 100) => get<CallRow[]>(`/api/calls?limit=${limit}`),
  createServer: (body: Record<string, unknown>) =>
    send('/api/servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  patchServer: (id: string, body: Record<string, unknown>) =>
    send(`/api/servers/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  deleteServer: (id: string) => send(`/api/servers/${id}`, { method: 'DELETE' }),
  /** Master switch: enable/disable every registered server in one write. */
  setAllServersEnabled: (enabled: boolean) =>
    send('/api/servers', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }),
  server: (id: string) => get<ServerRow>(`/api/servers/${id}`),
  serverTools: (id: string) => get<{ tools: ToolInfo[] }>(`/api/servers/${id}/tools`),
  setToolEnabled: (id: string, tool: string, enabled: boolean) =>
    send(`/api/servers/${id}/tools/${encodeURIComponent(tool)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }),
  /** Master switch: enable/disable many of one server's tools in one write. */
  setServerToolsEnabled: (id: string, tools: string[], enabled: boolean) =>
    send(`/api/servers/${id}/tools`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled, tools }),
    }),
  callsForServer: (id: string, limit = 100) => get<CallRow[]>(`/api/calls?serverId=${id}&limit=${limit}`),
  allTools: () => get<{ tools: AggTool[]; errors: { slug: string; error: string }[] }>('/api/tools'),
};

/** Poll a fetcher on an interval; returns latest data, error, and a manual refresh. */
export function usePoll<T>(fn: () => Promise<T>, intervalMs = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fn()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [fn]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { data, error, refresh };
}

/** Client-side pagination over an in-memory list. */
export function usePaged<T>(items: T[], pageSize = 20) {
  const [page, setPage] = useState(1);
  const start = (page - 1) * pageSize;
  return {
    page,
    setPage,
    pageItems: items.slice(start, start + pageSize),
    totalItems: items.length,
    pageSize,
  };
}

/** One-shot async fetch with loading state and a manual refresh (no polling). */
export function useAsync<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    fn()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [fn]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
