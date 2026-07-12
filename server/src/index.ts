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

// The vMCP endpoints Claude connects to stay at the ROOT path (the reverse proxy routes /mcp/
// here). Keeping it at root means existing client configs and the mocked bearer flow are
// unaffected by the dashboard moving under /vmcp/. Identity is resolved for every request but
// enforced per route: `/mcp/:slug` requires the mocked bearer, while the aggregate `/mcp`
// catalog is readable anonymously and gates only tool execution.
app.use("/mcp", identityMiddleware, mcpRouter);

// Everything the Carbon dashboard needs lives under the /vmcp/ prefix (matching the client's
// Vite `base`), so it serves correctly behind the reverse proxy at /vmcp/ and when hit directly
// at :8001/vmcp/. The dashboard data API and the mock-token dev helper move under it too.
const dash = express.Router();
// Runtime config for the dashboard. HOME_URL (env, default "/") is the link back to the platform
// home page — configurable per deployment without rebuilding the client.
dash.get("/config.json", (_req, res) => {
  res.json({ homeUrl: process.env.HOME_URL || "/" });
});
dash.get("/auth/mock-token", (req, res) => {
  const user = String(req.query.user ?? "").trim();
  if (!user) {
    res.status(400).json({ error: "provide ?user=<id>" });
    return;
  }
  res.json({ user, token: mintMockToken(user) });
});
dash.use("/api", apiRouter);
const webDist = resolve(repoRoot, "web/dist");
if (existsSync(webDist)) {
  dash.use(express.static(webDist));
  // SPA fallback for client routes — everything except the dashboard's own api/auth paths.
  dash.get(/^(?!\/(?:api|auth)\b).*/, (_req, res) => {
    res.sendFile(resolve(webDist, "index.html"));
  });
}
app.use("/vmcp", dash);

// Direct hits to root go to the dashboard (behind the platform proxy, / is the home page).
app.get("/", (_req, res) => res.redirect("/vmcp/"));

const port = Number(process.env.PORT ?? 8001);
app.listen(port, () => {
  console.log(`vMCP gateway listening on http://localhost:${port}`);
});
