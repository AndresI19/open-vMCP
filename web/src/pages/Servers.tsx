import {
  Button,
  InlineNotification,
  Pagination,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextInput,
  Tile,
  Toggle,
} from '@carbon/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ServerRow, api, mcpEndpoint, usePaged, usePoll } from '../api';
import { isAdmin } from '../auth';
import MasterToggle from '../components/MasterToggle';
import { useCardLabels } from '../components/useCardLabels';

export default function Servers() {
  const cards = useCardLabels();
  const navigate = useNavigate();
  const { data, refresh } = usePoll(api.servers, 8000);
  const servers = data ?? [];
  const { page, setPage, pageItems: pageServers, pageSize } = usePaged(servers);

  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const [form, setForm] = useState({ slug: '', name: '', url: '', transport: 'sse' });

  // NOT window.location.origin: the dashboard is served from the FRONT-END host, which doesn't serve
  // /mcp (it 404s naming the api host so a misconfigured client fails loudly), so the page origin
  // would print an address guaranteed to fail in production. mcpEndpoint() comes from
  // /vmcp/config.json: same-origin locally, the api host in production — not the in-cluster Service
  // address either, since the client reading this runs outside the cluster.
  const origin = mcpEndpoint().replace(/\/mcp$/, '');

  async function addServer() {
    setError(null);
    const res = await api.createServer(form);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === 'string' ? body.error : 'Failed to create server');
      return;
    }
    setForm({ slug: '', name: '', url: '', transport: 'sse' });
    refresh();
  }

  async function toggle(s: ServerRow) {
    await api.patchServer(s.id, { enabled: !s.enabled });
    refresh();
  }

  async function setAllEnabled(enabled: boolean) {
    await api.setAllServersEnabled(enabled);
    refresh();
  }

  async function remove(s: ServerRow) {
    await api.deleteServer(s.id);
    refresh();
  }

  return (
    <>
      <h1 style={{ marginBottom: '0.5rem' }}>MCP Servers</h1>
      <p style={{ color: 'var(--cds-text-secondary)', marginBottom: '1rem' }}>
        The data-driven registry of upstreams the gateway fronts. Hover a row to see its connection URL; click
        a row to open it. Disabled servers are hidden from all clients.
      </p>

      {/* Both endpoints a client can connect to. Hovering a row fills in <server> below. */}
      <Tile style={{ marginBottom: '1.5rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <code style={{ fontSize: '0.95rem' }}>{origin}/mcp</code>
            <Tag type="blue">aggregate</Tag>
          </div>
          <p style={{ color: 'var(--cds-text-secondary)', marginTop: '0.25rem' }}>
            Every enabled server at once. Tool names arrive namespaced as{' '}
            <code>&lt;server&gt;__&lt;tool&gt;</code>. Listing the catalog needs no token; calling a tool
            does.
          </p>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <code style={{ fontSize: '0.95rem' }}>
              {origin}/mcp/
              {hovered ? (
                <span style={{ color: 'var(--cds-support-info)', fontWeight: 600 }}>{hovered}</span>
              ) : (
                <span style={{ color: 'var(--cds-text-placeholder)' }}>&lt;server&gt;</span>
              )}
            </code>
            <Tag type="gray">single server</Tag>
          </div>
          <p style={{ color: 'var(--cds-text-secondary)', marginTop: '0.25rem' }}>
            One upstream, tool names unchanged. Requires a token.
          </p>
        </div>
      </Tile>

      <div style={{ marginBottom: '2rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <MasterToggle
            id="toggle-all-servers"
            noun="servers"
            total={servers.length}
            enabledCount={servers.filter((s) => s.enabled).length}
            onSet={setAllEnabled}
          />
        </div>
        <div ref={cards}>
          <TableContainer>
            <Table size="lg">
              <TableHead>
                <TableRow>
                  <TableHeader>Server</TableHeader>
                  <TableHeader>Name</TableHeader>
                  <TableHeader>Endpoint</TableHeader>
                  <TableHeader>Transport</TableHeader>
                  <TableHeader>Enabled</TableHeader>
                  <TableHeader>Visible to</TableHeader>
                  <TableHeader>Actions</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {pageServers.map((s) => (
                  <TableRow
                    key={s.id}
                    onClick={() => navigate(`/servers/${s.id}`)}
                    onMouseEnter={() => setHovered(s.slug)}
                    onMouseLeave={() => setHovered(null)}
                    style={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      <code>{s.slug}</code>
                    </TableCell>
                    <TableCell>{s.name}</TableCell>
                    <TableCell>
                      <code style={{ fontSize: '0.75rem' }}>{s.url}</code>
                    </TableCell>
                    <TableCell>{s.transport}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Toggle
                        id={`toggle-${s.id}`}
                        size="sm"
                        toggled={s.enabled}
                        labelA=""
                        labelB=""
                        aria-label="Enabled"
                        onToggle={() => toggle(s)}
                      />
                    </TableCell>
                    <TableCell>
                      <Tag type="gray" title="RBAC placeholder">
                        all users
                      </Tag>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Button kind="danger--ghost" size="sm" onClick={() => remove(s)}>
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </div>
        <Pagination
          totalItems={servers.length}
          pageSize={pageSize}
          pageSizes={[pageSize]}
          page={page}
          onChange={({ page: p }) => setPage(p)}
        />
      </div>

      {/* The write surface, admin-only as a courtesy not a defence — the server 403s the POST from
          anyone else regardless. A non-admin sees the read-only note instead. */}
      {!isAdmin() && (
        <Tile style={{ marginBottom: '1.5rem' }}>
          <p style={{ color: 'var(--cds-text-secondary)', fontSize: '0.85rem' }}>
            You are viewing the registry read-only. Registering, editing, or removing a server needs an admin
            — sign in top-right.
          </p>
        </Tile>
      )}

      {isAdmin() && (
        <Tile>
          <h4 style={{ marginBottom: '1rem' }}>Register an MCP server</h4>
          {error && (
            <InlineNotification
              kind="error"
              title="Error"
              subtitle={error}
              lowContrast
              onCloseButtonClick={() => setError(null)}
              style={{ marginBottom: '1rem' }}
            />
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', maxWidth: 640 }}>
            <TextInput
              id="slug"
              labelText="Server"
              placeholder="my-mcp"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
            />
            <TextInput
              id="name"
              labelText="Name"
              placeholder="My MCP"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Select
              id="transport"
              labelText="Transport"
              value={form.transport}
              onChange={(e) => setForm({ ...form, transport: e.target.value })}
            >
              <SelectItem value="sse" text="SSE" />
              <SelectItem value="streamable-http" text="Streamable HTTP" />
            </Select>
            <TextInput
              id="url"
              labelText="Upstream URL"
              placeholder="http://my-mcp.platform.svc.cluster.local:8000/sse"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          </div>
          <Button style={{ marginTop: '1rem' }} onClick={addServer}>
            Add server
          </Button>
        </Tile>
      )}
    </>
  );
}
