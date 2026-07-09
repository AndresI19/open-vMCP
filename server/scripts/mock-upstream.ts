import { randomUUID } from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// A tiny stand-in MCP server (Streamable HTTP) so the gateway can be demoed without
// the Python rs-mcp-server. Register it via the dashboard or:
//   curl -XPOST localhost:8001/api/servers -H 'content-type: application/json' \
//     -d '{"slug":"mock","name":"Mock","url":"http://localhost:8009/mcp","transport":"streamable-http"}'

function makeServer(): McpServer {
  const server = new McpServer({ name: "mock-upstream", version: "0.1.0" });

  server.registerTool(
    "get_item_price",
    {
      description: "Mock Grand Exchange price for an item.",
      inputSchema: { item_name: z.string(), game: z.enum(["osrs", "rs3"]).default("osrs") },
    },
    async ({ item_name, game }) => ({
      content: [
        {
          type: "text",
          text: `${item_name} (${game}) — mock price: ${1000 + item_name.length * 137} gp`,
        },
      ],
    }),
  );

  server.registerTool(
    "ping",
    { description: "Health check.", inputSchema: {} },
    async () => ({ content: [{ type: "text", text: "pong" }] }),
  );

  return server;
}

const app = express();
app.use(express.json());
const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", async (req, res) => {
  const sid = req.headers["mcp-session-id"] as string | undefined;
  if (sid && transports.has(sid)) {
    await transports.get(sid)!.handleRequest(req, res, req.body);
    return;
  }
  if (sid || !isInitializeRequest(req.body)) {
    res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "expected initialize" }, id: null });
    return;
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => transports.set(id, transport),
  });
  transport.onclose = () => {
    if (transport.sessionId) transports.delete(transport.sessionId);
  };
  await makeServer().connect(transport);
  await transport.handleRequest(req, res, req.body);
});

async function sessionReq(req: express.Request, res: express.Response) {
  const sid = req.headers["mcp-session-id"] as string | undefined;
  if (!sid || !transports.has(sid)) {
    res.status(400).send("no session");
    return;
  }
  await transports.get(sid)!.handleRequest(req, res);
}
app.get("/mcp", sessionReq);
app.delete("/mcp", sessionReq);

const port = Number(process.env.MOCK_PORT ?? 8009);
app.listen(port, () => console.log(`mock upstream MCP (streamable-http) on http://localhost:${port}/mcp`));
