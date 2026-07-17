import './env.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { apiRouter } from './api/index.js';
import { identityMiddleware, requireAdminForWrites } from './auth/middleware.js';
import { loadAuthConfig } from './config/load.js';
import { mcpRouter } from './mcp/router.js';
import { repoRoot } from './paths.js';

// Fail fast if config/auth.json is missing or invalid.
loadAuthConfig();

const app = express();
// Behind nginx/Cloudflare, the real client IP is in X-Forwarded-For, not on the socket; without this
// the limiter below would bucket the whole internet as one IP.
app.set('trust proxy', true);
app.use(express.json({ limit: '4mb' }));

// Coarse global cap on MUTATING requests (scraping/brute-force defence-in-depth). Reads are SKIPPED
// deliberately: behind Cloudflare nginx sees only a few edge IPs, so `trust proxy` can't separate
// clients, and the dashboard's 5s polling plus the home page's liveness badges would collapse into
// one bucket that 429s everyone (which took the badges offline). Per-process; resets on restart.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
  // We deliberately trust our own proxy chain; silence the permissive-trust-proxy validation.
  validate: { trustProxy: false },
});
app.use(limiter);

/**
 * CORS for the data API. Only matters when dashboard and API are on different hostnames; in a
 * same-origin deploy CORS_ORIGINS is empty and this does nothing. Explicit allow-list, not `*`: a
 * browser won't send credentials to a wildcard origin, and `*` would let any page read the call log.
 */
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    // Writes must be listed: dashboard and API are cross-origin, so a PATCH/POST/DELETE preflights,
    // and a preflight answering only "GET, HEAD, OPTIONS" makes the browser BLOCK the write before it
    // is sent — the request never arrives, so the app-layer admin check never runs. CORS is not the
    // authorisation boundary (requireAdminForWrites is), so allowing the methods loosens nothing.
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  // Answer the preflight here rather than letting it fall through to a route that only knows GET.
  if (req.method === 'OPTIONS') {
    res.sendStatus(origin && CORS_ORIGINS.includes(origin) ? 204 : 403);
    return;
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// The version this image was built from. Baked into <root>/VERSION by the Dockerfile (k8s/deploy.sh
// stamps it from the latest git tag, suffixed -snapshot when source differs from main). Read once —
// it can't change without a new image. Absent in a dev checkout, hence "snapshot".
const VERSION = ((): string => {
  try {
    return readFileSync(resolve(repoRoot, 'VERSION'), 'utf8').trim() || 'snapshot';
  } catch {
    return 'snapshot';
  }
})();
app.get('/version', (_req, res) => {
  res.json({ version: VERSION });
});

// The vMCP endpoints Claude connects to stay at ROOT (the reverse proxy routes /mcp/ here), so
// existing client configs are unaffected by the dashboard moving under /vmcp/. Identity is resolved
// for every request but enforced per route: `/mcp/:slug` requires a bearer, while the aggregate
// `/mcp` catalog is readable anonymously and gates only tool execution.
app.use('/mcp', identityMiddleware, mcpRouter);

// Everything the Carbon dashboard needs lives under the /vmcp/ prefix (matching the client's Vite
// `base`), so it serves correctly behind the proxy at /vmcp/ and when hit directly at :8001/vmcp/.
const dash = express.Router();
// Runtime config for the dashboard. HOME_URL (env, default "/") links back to the platform home
// page — configurable per deploy without rebuilding the client.
dash.get('/config.json', (_req, res) => {
  res.json({
    homeUrl: process.env.HOME_URL || '/',
    // Where the dashboard sends its data-API calls. Empty = same-origin (the /vmcp/ prefix it is
    // served from), the local default; in production this is the API host — separate origins, no
    // rebuild.
    apiBase: process.env.VMCP_API_BASE || '',
    // The MCP endpoint to TELL A CLIENT ABOUT (Overview's "Connect a client" panel). Empty =
    // same-origin, correct behind the proxy that serves /mcp; in production the overlay sets the
    // public API host. It must NOT be the page origin (hands every visitor their own laptop) nor the
    // in-cluster Service address (CoreDNS/10.96.x.x resolve only inside the cluster — this client
    // runs outside).
    mcpUrl: process.env.MCP_PUBLIC_URL || '',
  });
});
// The /auth/mock-token endpoint is GONE: with verification on it could only mint tokens that get
// rejected. Clients now use the real bearer from platform-auth. Identity is resolved here and writes
// require an admin (replacing the old nginx method filter); reads stay open — a dashboard is for
// looking at.
dash.use('/api', identityMiddleware, requireAdminForWrites, apiRouter);
const webDist = resolve(repoRoot, 'web/dist');
if (existsSync(webDist)) {
  dash.use(express.static(webDist));
  // SPA fallback for client routes — everything except the dashboard's own api/auth paths.
  dash.get(/^(?!\/(?:api|auth)\b).*/, (_req, res) => {
    res.sendFile(resolve(webDist, 'index.html'));
  });
}
app.use('/vmcp', dash);

// Direct hits to root go to the dashboard (behind the platform proxy, / is the home page).
app.get('/', (_req, res) => res.redirect('/vmcp/'));

/**
 * The API error handler: without it a failing DB query falls through to Express's default HTML error
 * page — to a client parsing JSON. Every API route now fails as JSON, reason in the log not the wire.
 *
 * Must take four arguments: Express identifies error handlers by arity, so dropping the unused
 * `_next` would silently turn this into an ordinary middleware that never runs.
 */
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error] %s %s:', req.method, req.originalUrl, err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'internal error' });
});

const port = Number(process.env.PORT ?? 8001);
app.listen(port, () => {
  console.log(`vMCP gateway listening on http://localhost:${port}`);
});
