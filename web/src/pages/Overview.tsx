import { useState } from "react";
import { Grid, Column, Tile, TextInput, Button, InlineNotification } from "@carbon/react";
import { LineChart } from "@carbon/charts-react";
import { ScaleTypes } from "@carbon/charts";
import { api, usePoll } from "../api";

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Tile>
      <p style={{ color: "var(--cds-text-secondary)", marginBottom: "0.5rem" }}>{label}</p>
      <p style={{ fontSize: "2rem", fontWeight: 300 }}>{value}</p>
    </Tile>
  );
}

export default function Overview() {
  const { data: ov } = usePoll(api.overview);
  const { data: series } = usePoll(api.timeseries);

  const [user, setUser] = useState("andres");
  const [token, setToken] = useState<string | null>(null);

  const chartData = (series ?? []).map((p) => ({
    group: "calls",
    date: p.ts,
    value: p.count,
  }));

  return (
    <>
      <h1 style={{ marginBottom: "1.5rem" }}>Overview</h1>

      <Grid narrow style={{ marginBottom: "1.5rem" }}>
        <Column sm={2} md={2} lg={3}>
          <Kpi label="Total tool calls" value={String(ov?.totalCalls ?? "—")} />
        </Column>
        <Column sm={2} md={2} lg={3}>
          <Kpi label="Unique users" value={String(ov?.uniqueUsers ?? "—")} />
        </Column>
        <Column sm={2} md={2} lg={3}>
          <Kpi label="Active servers" value={String(ov?.activeServers ?? "—")} />
        </Column>
        <Column sm={2} md={2} lg={3}>
          <Kpi
            label="Error rate"
            value={ov ? `${(ov.errorRate * 100).toFixed(1)}%` : "—"}
          />
        </Column>
      </Grid>

      <Tile style={{ marginBottom: "1.5rem" }}>
        <LineChart
          data={chartData}
          options={{
            title: "Tool calls over time",
            axes: {
              bottom: { title: "Time", mapsTo: "date", scaleType: ScaleTypes.TIME },
              left: { title: "Calls", mapsTo: "value", scaleType: ScaleTypes.LINEAR },
            },
            height: "320px",
          }}
        />
      </Tile>

      <Tile>
        <h4 style={{ marginBottom: "1rem" }}>Connect a client</h4>
        <p style={{ color: "var(--cds-text-secondary)", marginBottom: "1rem" }}>
          Point an MCP client at <code>http://localhost:8001/mcp/&lt;slug&gt;</code> and send a
          bearer token. Mint a mock token for a user below.
        </p>
        <div style={{ display: "flex", gap: "1rem", alignItems: "flex-end", maxWidth: 520 }}>
          <TextInput
            id="mint-user"
            labelText="User id"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
          <Button
            onClick={async () => {
              const r = await api.mockToken(user);
              setToken(r.token);
            }}
          >
            Mint token
          </Button>
        </div>
        {token && (
          <InlineNotification
            kind="info"
            title="Mock bearer token"
            subtitle={token}
            lowContrast
            style={{ marginTop: "1rem", maxWidth: "100%" }}
          />
        )}
      </Tile>
    </>
  );
}
