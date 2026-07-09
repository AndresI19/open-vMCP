import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { requireIdentity } from "../auth/middleware.js";
import { findVisibleServer } from "../registry/index.js";
import { connectUpstream } from "./upstream.js";
import { buildProxyServer } from "./proxy.js";
import { buildAggregateServer, collectTools } from "./aggregate.js";
import { sessions } from "./sessions.js";

function rpcError(message: string, code = -32000) {
  return { jsonrpc: "2.0" as const, error: { code, message }, id: null };
}

export const mcpRouter = Router();

// ---------------------------------------------------------------------------
// Aggregate endpoint: `/mcp` with no slug, fronting every visible server at once.
// Deliberately reachable without a bearer — see buildAggregateServer for where the
// authentication boundary actually sits (listing is open, calling is not).
// ---------------------------------------------------------------------------

mcpRouter.post("/", async (req: Request, res: Response) => {
  const sid = req.headers["mcp-session-id"] as string | undefined;

  // Reuse an established session.
  if (sid && sessions.has(sid)) {
    const s = sessions.get(sid)!;
    if (s.slug !== null) {
      res.status(400).json(rpcError("Session does not belong to the aggregate endpoint"));
      return;
    }
    await s.transport.handleRequest(req, res, req.body);
    return;
  }

  // An unrecognized session id means the session is gone — the gateway restarted, or it
  // expired. MCP mandates 404 here, and a compliant client responds by discarding the id
  // and re-initializing. A 400 reads as "malformed request", so a client that sent a
  // perfectly well-formed frame has no reason to drop the id, and replays it forever.
  if (sid) {
    res.status(404).json(rpcError("Session not found; reinitialize to start a new session"));
    return;
  }

  // No session id at all: only an initialize request may open one.
  if (!isInitializeRequest(req.body)) {
    res.status(400).json(rpcError("No valid session; expected an initialize request"));
    return;
  }

  const userId = req.userId ?? null;

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { transport, server, upstream: null, slug: null, userId });
    },
  });

  transport.onclose = () => {
    const id = transport.sessionId;
    if (id) sessions.delete(id);
  };

  const server = buildAggregateServer({
    userId,
    bearer: req.bearer,
    sessionId: () => transport.sessionId ?? null,
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

/**
 * With a session id this is the server→client SSE stream, same as any MCP endpoint.
 * Without one it is a plain JSON view of the aggregate catalog, so `curl /mcp` shows
 * what the gateway fronts instead of a protocol error.
 */
mcpRouter.get("/", async (req: Request, res: Response) => {
  const sid = req.headers["mcp-session-id"] as string | undefined;
  if (sid) {
    await handleSessionRequest(req, res);
    return;
  }

  // An MCP client opening a stream without a session id is a protocol error, not a
  // browser asking to look at the catalog.
  if (String(req.headers.accept ?? "").includes("text/event-stream")) {
    res.status(400).send("Missing session id");
    return;
  }

  const userId = req.userId ?? null;
  const { tools, errors } = await collectTools(userId, req.bearer);
  res.json({
    endpoint: "/mcp",
    user: userId,
    count: tools.length,
    tools: tools.map((t) => ({
      name: t.name,
      serverSlug: t.serverSlug,
      description: t.description ?? "",
    })),
    errors,
  });
});

mcpRouter.delete("/", (req: Request, res: Response) => handleSessionRequest(req, res));

// ---------------------------------------------------------------------------
// Per-server endpoint: `/mcp/:slug`, a 1:1 passthrough. Always requires an identity.
// ---------------------------------------------------------------------------

// POST carries initialize + all JSON-RPC requests.
mcpRouter.post("/:slug", requireIdentity, async (req: Request, res: Response) => {
  const slug = String(req.params.slug);
  const sid = req.headers["mcp-session-id"] as string | undefined;

  // Reuse an established session.
  if (sid && sessions.has(sid)) {
    const s = sessions.get(sid)!;
    if (s.slug !== slug) {
      res.status(400).json(rpcError("Session does not belong to this server"));
      return;
    }
    await s.transport.handleRequest(req, res, req.body);
    return;
  }

  // An unrecognized session id means the session is gone — the gateway restarted, or it
  // expired. MCP mandates 404 here, and a compliant client responds by discarding the id
  // and re-initializing. A 400 reads as "malformed request", so a client that sent a
  // perfectly well-formed frame has no reason to drop the id, and replays it forever.
  if (sid) {
    res.status(404).json(rpcError("Session not found; reinitialize to start a new session"));
    return;
  }

  // No session id at all: only an initialize request may open one.
  if (!isInitializeRequest(req.body)) {
    res.status(400).json(rpcError("No valid session; expected an initialize request"));
    return;
  }

  const userId = req.userId ?? null;
  const serverRow = await findVisibleServer(userId, slug);
  if (!serverRow) {
    res.status(404).json(rpcError(`Unknown or not-permitted MCP server: ${slug}`));
    return;
  }

  let upstream: Client;
  try {
    upstream = await connectUpstream(serverRow, req.bearer);
  } catch (err) {
    res.status(502).json(rpcError(`Upstream connect failed: ${(err as Error).message}`));
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { transport, server, upstream, slug, userId });
    },
  });

  transport.onclose = () => {
    const id = transport.sessionId;
    if (id) sessions.delete(id);
    void upstream.close().catch(() => {});
  };

  const server = buildProxyServer({
    server: serverRow,
    upstream,
    externalUserId: userId,
    sessionId: () => transport.sessionId ?? null,
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// GET = the server→client SSE notification stream; DELETE = explicit session end.
async function handleSessionRequest(req: Request, res: Response) {
  const sid = req.headers["mcp-session-id"] as string | undefined;
  // Missing id is a malformed request; an id we don't know is a session that no longer
  // exists. Only the latter tells a client to re-initialize, so they cannot share a code.
  if (!sid) {
    res.status(400).send("Missing session id");
    return;
  }
  if (!sessions.has(sid)) {
    res.status(404).send("Session not found");
    return;
  }
  await sessions.get(sid)!.transport.handleRequest(req, res);
}

mcpRouter.get("/:slug", requireIdentity, handleSessionRequest);
mcpRouter.delete("/:slug", requireIdentity, handleSessionRequest);
