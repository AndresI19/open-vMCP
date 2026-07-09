import "../src/env.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// A real MCP client talking to the vMCP (Streamable HTTP) with a mocked bearer,
// which the gateway proxies through to the upstream RS server (SSE).
const base = process.env.VMCP_URL ?? "http://localhost:8001/mcp/rs-mcp";
// Unsigned mock token carrying { user: "andres" }.
const token =
  process.env.MOCK_TOKEN ?? "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyIjoiYW5kcmVzIn0.";

const client = new Client({ name: "e2e-smoke", version: "0.0.0" }, { capabilities: {} });
const transport = new StreamableHTTPClientTransport(new URL(base), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});

await client.connect(transport);
console.log("✓ connected; session:", transport.sessionId);

const tools = await client.listTools();
console.log(`✓ tools/list → ${tools.tools.length} tools`);
console.log("  sample:", tools.tools.slice(0, 6).map((t) => t.name).join(", "));

const res = await client.callTool({
  name: "get_item_price",
  arguments: { item_name: "Abyssal whip", game: "osrs" },
});
const text = (res.content as Array<{ type: string; text?: string }>)
  .filter((c) => c.type === "text")
  .map((c) => c.text)
  .join("\n");
console.log("✓ callTool get_item_price →", text.slice(0, 200));

await client.close();
console.log("✓ done");
process.exit(0);
