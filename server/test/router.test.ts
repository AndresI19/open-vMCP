import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Characterization tests for the HTTP session routing in mcp/router.ts.
 *
 * Pins the status codes and error bodies for the session-lifecycle branches — reuse,
 * unknown-session (404, not 400), no-session-non-initialize (400), and cross-endpoint
 * session ownership — without opening a real MCP transport. The transport on a reused
 * session is a spy; the aggregate/proxy builders and the registry are mocked.
 */

const { sessions } = vi.hoisted(() => ({
  sessions: new Map<
    string,
    { slug: string | null; transport: { handleRequest: ReturnType<typeof vi.fn> } }
  >(),
}));

vi.mock('../src/mcp/sessions.js', () => ({ sessions }));
vi.mock('../src/mcp/aggregate.js', () => ({
  collectTools: vi.fn(),
  buildAggregateServer: vi.fn(),
}));
vi.mock('../src/mcp/proxy.js', () => ({ buildProxyServer: vi.fn() }));
vi.mock('../src/mcp/upstream.js', () => ({ connectUpstream: vi.fn() }));
vi.mock('../src/registry/index.js', () => ({ findVisibleServer: vi.fn() }));
vi.mock('../src/auth/middleware.js', () => ({
  // Passthrough so the /:slug routes are reachable without a real auth config.
  requireIdentity: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import { collectTools } from '../src/mcp/aggregate.js';
import { mcpRouter } from '../src/mcp/router.js';
import { findVisibleServer } from '../src/registry/index.js';

let base: string;
let server: ReturnType<express.Express['listen']>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/mcp', mcpRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/mcp`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  sessions.clear();
  vi.clearAllMocks();
});
afterEach(() => sessions.clear());

const initBody = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } },
};

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('aggregate endpoint POST /mcp', () => {
  it('404s an unknown session id, telling the client to reinitialize', async () => {
    const res = await post('/', {}, { 'mcp-session-id': 'ghost' });
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toMatch(/reinitialize/);
  });

  it('400s a request with no session id that is not an initialize', async () => {
    const res = await post('/', { jsonrpc: '2.0', method: 'tools/list', id: 1 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/expected an initialize request/);
  });

  it('rejects a session that belongs to a per-slug endpoint', async () => {
    sessions.set('s1', { slug: 'rs-mcp', transport: { handleRequest: vi.fn() } });
    const res = await post('/', {}, { 'mcp-session-id': 's1' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/does not belong to the aggregate endpoint/);
  });

  it('reuses an established aggregate session via its transport', async () => {
    const handleRequest = vi.fn(async (_req, res) => res.json({ reused: true }));
    sessions.set('s1', { slug: null, transport: { handleRequest } });
    const res = await post('/', { jsonrpc: '2.0', method: 'ping', id: 1 }, { 'mcp-session-id': 's1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reused: true });
    expect(handleRequest).toHaveBeenCalledOnce();
  });
});

describe('aggregate catalog GET /mcp', () => {
  it('returns a plain JSON catalog for a non-SSE GET with no session', async () => {
    vi.mocked(collectTools).mockResolvedValue({
      tools: [
        // biome-ignore lint/suspicious/noExplicitAny: partial AggregateTool for the view.
        { name: 'rs-mcp__search', serverSlug: 'rs-mcp', description: 'd' } as any,
      ],
      errors: [],
    });
    const res = await fetch(base, { headers: { accept: 'application/json' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      endpoint: '/mcp',
      count: 1,
      tools: [{ name: 'rs-mcp__search', serverSlug: 'rs-mcp', description: 'd' }],
    });
  });

  it('400s an SSE stream request with no session id', async () => {
    const res = await fetch(base, { headers: { accept: 'text/event-stream' } });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Missing session id/);
  });
});

describe('per-server endpoint POST /mcp/:slug', () => {
  it('404s an unknown session id', async () => {
    const res = await post('/rs-mcp', {}, { 'mcp-session-id': 'ghost' });
    expect(res.status).toBe(404);
  });

  it('rejects a session that belongs to a different server', async () => {
    sessions.set('s1', { slug: 'other', transport: { handleRequest: vi.fn() } });
    const res = await post('/rs-mcp', {}, { 'mcp-session-id': 's1' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/does not belong to this server/);
  });

  it('400s a no-session request that is not an initialize', async () => {
    const res = await post('/rs-mcp', { jsonrpc: '2.0', method: 'tools/list', id: 1 });
    expect(res.status).toBe(400);
  });

  it('404s an initialize for an unknown or not-permitted server', async () => {
    vi.mocked(findVisibleServer).mockResolvedValue(null);
    const res = await post('/rs-mcp', initBody);
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toMatch(/Unknown or not-permitted MCP server: rs-mcp/);
  });
});

describe('session teardown DELETE /mcp', () => {
  it('400s a DELETE with no session id', async () => {
    const res = await fetch(base, { method: 'DELETE' });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Missing session id/);
  });

  it('404s a DELETE for an unknown session id', async () => {
    const res = await fetch(base, { method: 'DELETE', headers: { 'mcp-session-id': 'ghost' } });
    expect(res.status).toBe(404);
    expect(await res.text()).toMatch(/Session not found/);
  });
});
