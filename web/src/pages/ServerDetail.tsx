import {
  Button,
  InlineLoading,
  InlineNotification,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  Toggle,
} from '@carbon/react';
import { useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { type ToolInfo, api, useAsync, usePoll } from '../api';
import MasterToggle from '../components/MasterToggle';
import { DASH, StatusTag, fmtLatency, fmtTime } from '../format';

export default function ServerDetail() {
  const { id = '' } = useParams();

  const { data: server } = usePoll(
    useCallback(() => api.server(id), [id]),
    10000,
  );
  const {
    data: toolsData,
    loading: toolsLoading,
    error: toolsError,
    refresh: refreshTools,
  } = useAsync(useCallback(() => api.serverTools(id), [id]));
  const { data: calls } = usePoll(
    useCallback(() => api.callsForServer(id), [id]),
    4000,
  );

  const tools = toolsData?.tools ?? [];
  const serverDisabled = server ? !server.enabled : false;

  async function toggleTool(t: ToolInfo) {
    if (serverDisabled) return; // blocked: the whole server is disabled
    await api.setToolEnabled(id, t.name, !t.enabled);
    refreshTools();
  }

  async function setAllTools(enabled: boolean) {
    if (serverDisabled) return;
    await api.setServerToolsEnabled(
      id,
      tools.map((t) => t.name),
      enabled,
    );
    refreshTools();
  }

  return (
    <>
      <p style={{ marginBottom: '0.5rem' }}>
        <Link to="/servers">← MCP Servers</Link>
      </p>
      <h1 style={{ marginBottom: '0.25rem' }}>{server?.name ?? 'Server'}</h1>
      <p style={{ color: 'var(--cds-text-secondary)', marginBottom: '1.5rem' }}>
        <code>{server?.slug}</code> · {server?.transport} · {server?.url}
      </p>

      <Tabs>
        <TabList aria-label="Server detail">
          <Tab>Tools{tools.length ? ` (${tools.length})` : ''}</Tab>
          <Tab>Calls</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                margin: '1rem 0',
              }}
            >
              <p style={{ color: 'var(--cds-text-secondary)' }}>
                Disabling a tool hides it from <code>tools/list</code> and blocks <code>tools/call</code> at
                the gateway.
              </p>
              <Button kind="tertiary" size="sm" onClick={refreshTools} disabled={toolsLoading}>
                Refresh
              </Button>
            </div>
            {serverDisabled && (
              <InlineNotification
                kind="warning"
                title="Server disabled"
                subtitle="This server is disabled — its tools are unavailable to clients and can't be changed."
                lowContrast
                hideCloseButton
                style={{ marginBottom: '1rem' }}
              />
            )}
            {toolsError && (
              <InlineNotification
                kind="error"
                title="Could not load tools"
                subtitle={toolsError}
                lowContrast
                style={{ marginBottom: '1rem' }}
              />
            )}
            {toolsLoading && <InlineLoading description="Loading tools from the upstream server…" />}
            {!toolsLoading && !toolsError && tools.length === 0 && (
              <p style={{ color: 'var(--cds-text-secondary)' }}>No tools returned.</p>
            )}
            {tools.length > 0 && (
              <div style={{ marginBottom: '1rem' }}>
                <MasterToggle
                  id="toggle-all-server-tools"
                  noun="tools"
                  total={tools.length}
                  enabledCount={tools.filter((t) => t.enabled).length}
                  disabled={serverDisabled}
                  onSet={setAllTools}
                />
              </div>
            )}
            <TableContainer>
              <Table size="lg">
                <TableHead>
                  <TableRow>
                    <TableHeader>Tool</TableHeader>
                    <TableHeader>Description</TableHeader>
                    <TableHeader>Enabled</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tools.map((t) => (
                    <TableRow key={t.name}>
                      <TableCell>
                        <code>{t.name}</code>
                      </TableCell>
                      <TableCell>
                        <div style={{ maxWidth: 560, whiteSpace: 'normal' }}>{t.description}</div>
                      </TableCell>
                      <TableCell>
                        <Toggle
                          id={`tool-${t.name}`}
                          size="sm"
                          toggled={t.enabled && !serverDisabled}
                          disabled={serverDisabled}
                          labelA=""
                          labelB=""
                          aria-label={`Toggle ${t.name}`}
                          onToggle={() => toggleTool(t)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </TabPanel>

          <TabPanel>
            <TableContainer>
              <Table size="lg">
                <TableHead>
                  <TableRow>
                    <TableHeader>Time</TableHeader>
                    <TableHeader>User</TableHeader>
                    <TableHeader>Tool</TableHeader>
                    <TableHeader>Arguments</TableHeader>
                    <TableHeader>Status</TableHeader>
                    <TableHeader>Latency</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(calls ?? []).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{fmtTime(c.createdAt)}</TableCell>
                      <TableCell>
                        <code>{c.userExternalId ?? DASH}</code>
                      </TableCell>
                      <TableCell>{c.toolName}</TableCell>
                      <TableCell>
                        <code style={{ fontSize: '0.75rem' }}>{JSON.stringify(c.arguments)}</code>
                      </TableCell>
                      <TableCell>
                        <StatusTag status={c.status} />
                      </TableCell>
                      <TableCell>{fmtLatency(c.latencyMs)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </>
  );
}
