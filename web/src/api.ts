import { useCallback, useEffect, useState } from "react";

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

// Where the data API lives. Defaults to same-origin under the prefix the dashboard is served from
// (import.meta.env.BASE_URL, e.g. '/vmcp/'), which is the local deployment.
//
// In production the API is a separate origin (api-andres.project-platform.me), so this is overridden
// at RUNTIME from /vmcp/config.json — see setApiBase, called by main.tsx before the app renders.
// Runtime rather than build-time on purpose: the same image then runs locally and in production, and
// the hostname is a deploy concern, not a compile-time one.
let BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Point every subsequent API call at `base` (an absolute origin). Empty/undefined keeps the default. */
export function setApiBase(base: string | undefined): void {
  if (base) BASE = base.replace(/\/$/, "");
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return (await r.json()) as T;
}
const send = (path: string, init?: RequestInit): Promise<Response> => fetch(BASE + path, init);

export const api = {
  overview: () => get<Overview>("/api/stats/overview"),
  byTool: () => get<ToolStat[]>("/api/stats/by-tool"),
  timeseries: (bucket = "hour") => get<TimePoint[]>(`/api/stats/timeseries?bucket=${bucket}`),
  servers: () => get<ServerRow[]>("/api/servers"),
  users: () => get<UserRow[]>("/api/users"),
  calls: (limit = 100) => get<CallRow[]>(`/api/calls?limit=${limit}`),
  mockToken: (user: string) =>
    get<{ user: string; token: string }>(`/auth/mock-token?user=${encodeURIComponent(user)}`),
  createServer: (body: Record<string, unknown>) =>
    send("/api/servers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  patchServer: (id: string, body: Record<string, unknown>) =>
    send(`/api/servers/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  deleteServer: (id: string) => send(`/api/servers/${id}`, { method: "DELETE" }),
  /** Master switch: enable/disable every registered server in one write. */
  setAllServersEnabled: (enabled: boolean) =>
    send("/api/servers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),
  server: (id: string) => get<ServerRow>(`/api/servers/${id}`),
  serverTools: (id: string) => get<{ tools: ToolInfo[] }>(`/api/servers/${id}/tools`),
  setToolEnabled: (id: string, tool: string, enabled: boolean) =>
    send(`/api/servers/${id}/tools/${encodeURIComponent(tool)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),
  /** Master switch: enable/disable many of one server's tools in one write. */
  setServerToolsEnabled: (id: string, tools: string[], enabled: boolean) =>
    send(`/api/servers/${id}/tools`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled, tools }),
    }),
  callsForServer: (id: string, limit = 100) =>
    get<CallRow[]>(`/api/calls?serverId=${id}&limit=${limit}`),
  allTools: () =>
    get<{ tools: AggTool[]; errors: { slug: string; error: string }[] }>("/api/tools"),
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
