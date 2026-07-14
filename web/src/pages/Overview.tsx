import { ScaleTypes } from '@carbon/charts';
import { LineChart } from '@carbon/charts-react';
import { CodeSnippet, Column, Grid, Tile } from '@carbon/react';
import { useEffect, useState } from 'react';
import { api, mcpEndpoint, usePoll } from '../api';
import { token as authToken, current, isSignedIn } from '../auth';

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Tile>
      <p style={{ color: 'var(--cds-text-secondary)', marginBottom: '0.5rem' }}>{label}</p>
      <p style={{ fontSize: '2rem', fontWeight: 300 }}>{value}</p>
    </Tile>
  );
}

export default function Overview() {
  const { data: ov } = usePoll(api.overview);
  const { data: series } = usePoll(api.timeseries);

  // The real bearer, fetched from the identity you are signed in as. The old "mint a mock token"
  // control is gone: it produced an alg:none token the gateway now REJECTS, and on the public site
  // its request path collided with the real auth service and 404'd — a button that looked like it
  // worked and never could.
  const [tok, setTok] = useState<string | null>(null);
  useEffect(() => {
    if (isSignedIn()) void authToken().then(setTok);
  }, []);

  const chartData = (series ?? []).map((p) => ({
    group: 'calls',
    date: p.ts,
    value: p.count,
  }));

  return (
    <>
      <h1 style={{ marginBottom: '1.5rem' }}>Overview</h1>

      <Grid narrow style={{ marginBottom: '1.5rem' }}>
        <Column sm={2} md={2} lg={3}>
          <Kpi label="Total tool calls" value={String(ov?.totalCalls ?? '—')} />
        </Column>
        <Column sm={2} md={2} lg={3}>
          <Kpi label="Unique users" value={String(ov?.uniqueUsers ?? '—')} />
        </Column>
        <Column sm={2} md={2} lg={3}>
          <Kpi label="Active servers" value={String(ov?.activeServers ?? '—')} />
        </Column>
        <Column sm={2} md={2} lg={3}>
          <Kpi label="Error rate" value={ov ? `${(ov.errorRate * 100).toFixed(1)}%` : '—'} />
        </Column>
      </Grid>

      <Tile style={{ marginBottom: '1.5rem' }}>
        <LineChart
          data={chartData}
          options={{
            title: 'Tool calls over time',
            axes: {
              bottom: { title: 'Time', mapsTo: 'date', scaleType: ScaleTypes.TIME },
              left: { title: 'Calls', mapsTo: 'value', scaleType: ScaleTypes.LINEAR },
            },
            height: '320px',
          }}
        />
      </Tile>

      <Tile>
        <h4 style={{ marginBottom: '1rem' }}>Connect a client</h4>
        <p style={{ color: 'var(--cds-text-secondary)', marginBottom: '1rem' }}>
          Point an MCP client at <code>{mcpEndpoint()}/&lt;slug&gt;</code> and send your bearer token in the{' '}
          <code>Authorization</code> header.
        </p>
        {isSignedIn() && tok ? (
          <>
            <p style={{ color: 'var(--cds-text-secondary)', marginBottom: '0.5rem', fontSize: '0.8rem' }}>
              Your token as <strong>{current()?.username}</strong> — expires in 24h; sign in again to refresh.
            </p>
            <CodeSnippet type="multi" feedback="Copied">
              {`Authorization: Bearer ${tok}`}
            </CodeSnippet>
          </>
        ) : (
          <p style={{ color: 'var(--cds-text-secondary)', fontSize: '0.85rem' }}>
            Sign in (top-right) to get a token. No account? Create one on the quiz or the home page — it is
            the same identity everywhere.
          </p>
        )}
      </Tile>
    </>
  );
}
