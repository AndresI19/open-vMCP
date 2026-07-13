import "./env.js";
import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "./paths.js";
import { loadAuthConfig } from "./config/load.js";
import { identityMiddleware, requireAdminForWrites } from "./auth/middleware.js";
import { mcpRouter } from "./mcp/router.js";
import { apiRouter } from "./api/index.js";

// Fail fast if config/auth.json is missing or invalid.
loadAuthConfig();

const app = express();
app.use(express.json({ limit: "4mb" }));

/**
 * CORS for the data API. Needed only once the dashboard and the API are on different hostnames
 * (front end on andres.…, API on api-andres.…) — in a same-origin deployment CORS_ORIGINS is empty
 * and this middleware does nothing.
 *
 * An explicit allow-list, not `*`: the browser will not send credentials to a wildcard origin, and
 * a wildcard would also let any page on the internet read the call log from a visitor's browser.
 */
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    // Writes are included now. They used not to be, from when the data API was read-only in public
    // — but the dashboard and the API live on different origins, so a browser PATCH/POST/DELETE
    // triggers a CORS preflight, and a preflight that answers "GET, HEAD, OPTIONS" makes the browser
    // BLOCK the write before it is sent. That silently broke every write from the public dashboard,
    // the admin's included: the request never reached the server, so the app-layer admin check never
    // ran and the fetch just threw. CORS is not the authorisation boundary — requireAdminForWrites
    // is — so allowing the methods here loosens nothing; it just lets the request arrive to be judged.
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  // Answer the preflight here rather than letting it fall through to a route that only knows GET.
  if (req.method === "OPTIONS") {
    res.sendStatus(origin && CORS_ORIGINS.includes(origin) ? 204 : 403);
    return;
  }
  next();
});

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
  res.json({
    homeUrl: process.env.HOME_URL || "/",
    // Where the dashboard should send its data-API calls. Empty means same-origin (the /vmcp/
    // prefix it is already served from) — the local default. In production this is the API host,
    // so the front end and the back end are separate origins without rebuilding the client.
    apiBase: process.env.VMCP_API_BASE || "",
    // The MCP endpoint to TELL A CLIENT ABOUT — printed on the Overview page's "Connect a client"
    // panel. It used to be hardcoded to http://localhost:8001, which is only ever right on the
    // machine the gateway runs on; every public visitor was handed an address that resolves to
    // their own laptop.
    //
    // It cannot be the in-cluster Service address either (vmcp.platform.svc.cluster.local). That
    // resolves — but only for cluster members: CoreDNS does not answer outside the cluster, and the
    // 10.96.x.x Service IP is a virtual address that exists only in the node's routing rules. The
    // client this string is aimed at (Claude Desktop, an SDK) runs OUTSIDE, so it needs the address
    // that is actually reachable from there.
    //
    // Empty = same-origin, which is correct when the dashboard is reached through the same proxy
    // that serves /mcp. In production the overlay sets this to the public API host.
    mcpUrl: process.env.MCP_PUBLIC_URL || "",
  });
});
// The /auth/mock-token endpoint is GONE. It minted an unsigned alg:none token for the pre-auth
// world; with verification on, that token is rejected, so it could only ever hand out a credential
// that does not work. Worse, it was a live minter of forgeable-LOOKING tokens with no legitimate
// caller left. A client now uses the real bearer from platform-auth, which the dashboard holds.
// The dashboard API had NO authentication whatsoever — its writes were guarded only by an nginx
// method filter on the public vhost. Identity is resolved here and writes now require an admin; reads
// stay open, because a dashboard is for looking at.
dash.use("/api", identityMiddleware, requireAdminForWrites, apiRouter);
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

/**
 * The last middleware, and the only one that catches anything. Until now there was no error handler
 * at all: a failing DB query in /api/calls, /api/stats or /api/users fell through to Express's
 * default, which answers an HTML error page — to a client that asked for JSON and will try to parse
 * it. Every API route now fails as JSON, with the reason in the server log rather than on the wire.
 *
 * Must take four arguments. Express identifies error handlers by arity, so dropping the unused
 * `_next` would silently turn this back into an ordinary middleware that never runs.
 */
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return;
  res.status(500).json({ error: "internal error" });
});

const port = Number(process.env.PORT ?? 8001);
app.listen(port, () => {
  console.log(`vMCP gateway listening on http://localhost:${port}`);
});
