import "../src/env.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Ad-hoc MCP client through the gateway.
//   tsx scripts/call.ts <slug> <user> [toolName] [argsJson]
// Lists tools; if a tool name is given, calls it and prints the result.
const [slug, user, tool, argsJson] = process.argv.slice(2);
if (!slug || !user) {
  console.error("usage: call.ts <slug> <user> [toolName] [argsJson]");
  process.exit(1);
}

const gw = "http://localhost:8001";
const token = (await (await fetch(`${gw}/auth/mock-token?user=${encodeURIComponent(user)}`)).json())
  .token as string;

const client = new Client({ name: "call-cli", version: "0.0.0" }, { capabilities: {} });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${gw}/mcp/${slug}`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }),
);

const tools = await client.listTools();
console.log(`[${slug}] ${tools.tools.length} tools: ${tools.tools.map((t) => t.name).join(", ")}`);

if (tool) {
  const args = argsJson ? JSON.parse(argsJson) : {};
  const res = await client.callTool({ name: tool, arguments: args });
  const text = (res.content as Array<{ type: string; text?: string }>)
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  console.log(`[${slug}] ${tool}(${argsJson ?? "{}"}) → ${res.isError ? "ERROR " : ""}${text.slice(0, 400)}`);
}

await client.close();
process.exit(0);
