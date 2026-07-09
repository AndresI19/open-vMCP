import { useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  Toggle,
  Tag,
  Button,
  InlineLoading,
  InlineNotification,
  Pagination,
} from "@carbon/react";
import { api, useAsync, usePaged, type AggTool } from "../api";
import MasterToggle from "../components/MasterToggle";

export default function AllTools() {
  const { data, loading, error, refresh } = useAsync(useCallback(() => api.allTools(), []));
  const tools = data?.tools ?? [];
  const errors = data?.errors ?? [];

  // Tools of disabled servers sink to the bottom; otherwise group by server, then name.
  const sorted = [...tools].sort(
    (a, b) =>
      Number(b.serverEnabled) - Number(a.serverEnabled) ||
      a.serverSlug.localeCompare(b.serverSlug) ||
      a.name.localeCompare(b.name),
  );
  const { page, setPage, pageItems } = usePaged(sorted);

  // Tools on a disabled server can't be changed, so they don't count toward the master switch.
  const eligible = tools.filter((t) => t.serverEnabled);

  async function toggle(t: AggTool) {
    if (!t.serverEnabled) return; // blocked: the whole server is disabled
    await api.setToolEnabled(t.serverId, t.name, !t.enabled);
    refresh();
  }

  /** One bulk write per server rather than one request per tool. */
  async function setAllTools(enabled: boolean) {
    const byServer = new Map<string, string[]>();
    for (const t of eligible) {
      const names = byServer.get(t.serverId) ?? [];
      names.push(t.name);
      byServer.set(t.serverId, names);
    }
    await Promise.all(
      [...byServer].map(([serverId, names]) =>
        api.setServerToolsEnabled(serverId, names, enabled),
      ),
    );
    refresh();
  }

  return (
    <>
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <h1>All Tools</h1>
        <Button kind="tertiary" size="sm" onClick={refresh} disabled={loading}>
          Refresh
        </Button>
      </div>
      <p style={{ color: "var(--cds-text-secondary)", margin: "0.5rem 0 1.5rem" }}>
        Every tool across all enabled servers, aggregated — the same catalog a client sees at{" "}
        <code>/mcp</code>. The <strong>Server</strong> column (slug) is how you tell tools of
        the same name apart.
      </p>

      {loading && <InlineLoading description="Querying every enabled server…" />}
      {error && (
        <InlineNotification kind="error" title="Failed to load" subtitle={error} lowContrast />
      )}
      {errors.map((e) => (
        <InlineNotification
          key={e.slug}
          kind="warning"
          title={`${e.slug} unreachable`}
          subtitle={e.error}
          lowContrast
          style={{ marginBottom: "0.5rem" }}
        />
      ))}

      {!loading && (
        <>
        {eligible.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <MasterToggle
              id="toggle-all-tools"
              noun="tools"
              total={eligible.length}
              enabledCount={eligible.filter((t) => t.enabled).length}
              onSet={setAllTools}
            />
          </div>
        )}
        <Table size="lg">
          <TableHead>
            <TableRow>
              <TableHeader>Server</TableHeader>
              <TableHeader>Tool</TableHeader>
              <TableHeader>Description</TableHeader>
              <TableHeader>Enabled</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {pageItems.map((t) => (
              <TableRow
                key={`${t.serverSlug}:${t.name}`}
                style={t.serverEnabled ? undefined : { opacity: 0.5 }}
              >
                <TableCell>
                  <Link to={`/servers/${t.serverId}`}>
                    <Tag type={t.serverEnabled ? "blue" : "gray"}>{t.serverSlug}</Tag>
                  </Link>
                  {!t.serverEnabled && (
                    <Tag type="gray" size="sm">
                      server disabled
                    </Tag>
                  )}
                </TableCell>
                <TableCell>
                  <code>{t.name}</code>
                </TableCell>
                <TableCell>
                  <div style={{ maxWidth: 520, whiteSpace: "normal" }}>{t.description}</div>
                </TableCell>
                <TableCell>
                  <Toggle
                    id={`agg-${t.serverSlug}-${t.name}`}
                    size="sm"
                    toggled={t.serverEnabled && t.enabled}
                    disabled={!t.serverEnabled}
                    labelA=""
                    labelB=""
                    aria-label={`Toggle ${t.serverSlug}/${t.name}`}
                    onToggle={() => toggle(t)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pagination
          totalItems={tools.length}
          pageSize={20}
          pageSizes={[20]}
          page={page}
          onChange={({ page: p }) => setPage(p)}
        />
        </>
      )}
    </>
  );
}
