import "./env.js";
import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "./paths.js";
import { loadAuthConfig } from "./config/load.js";
import { identityMiddleware } from "./auth/middleware.js";
import { mintMockToken } from "./auth/mint.js";
import { mcpRouter } from "./mcp/router.js";
import { apiRouter } from "./api/index.js";

// Fail fast if config/auth.json is missing or invalid.
loadAuthConfig();

const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Dev helper: mint a mock bearer token for a given user to paste into a client config.
app.get("/auth/mock-token", (req, res) => {
  const user = String(req.query.user ?? "").trim();
  if (!user) {
    res.status(400).json({ error: "provide ?user=<id>" });
    return;
  }
  res.json({ user, token: mintMockToken(user) });
});

// Dashboard data API (open — operator view).
app.use("/api", apiRouter);

// The vMCP endpoints Claude connects to. Identity is resolved for every request but
// enforced per route: `/mcp/:slug` requires the mocked bearer, while the aggregate
// `/mcp` catalog is readable anonymously and gates only tool execution.
app.use("/mcp", identityMiddleware, mcpRouter);

// Serve the built Carbon dashboard if it exists; SPA fallback for client routes.
const webDist = resolve(repoRoot, "web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  // Express 5: use a RegExp catch-all that excludes the API/MCP/auth/health paths.
  app.get(/^(?!\/(?:api|mcp|auth|health)\b).*/, (_req, res) => {
    res.sendFile(resolve(webDist, "index.html"));
  });
}

const port = Number(process.env.PORT ?? 8001);
app.listen(port, () => {
  console.log(`vMCP gateway listening on http://localhost:${port}`);
});
