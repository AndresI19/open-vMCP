import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Characterization tests for the aggregate endpoint — the flattened, namespaced catalog
 * that fronts every visible upstream at once. These pin the CURRENT behavior so the
 * upcoming rewrite is guarded; they assert what the code does now, not what it "should" do.
 *
 * Every DB/network/telemetry seam is mocked in-memory. `withTimeout` is replaced by a
 * pass-through so no real timers run; `connectUpstream` returns a fake MCP client.
 */

// --- mocked seams (hoisted by vitest) -------------------------------------------------

vi.mock('../src/registry/index.js', () => ({
  visibleServers: vi.fn(),
  allServers: vi.fn(),
}));
vi.mock('../src/registry/tools.js', () => ({
  disabledToolNames: vi.fn(),
}));
vi.mock('../src/mcp/upstream.js', () => ({
  connectUpstream: vi.fn(),
  withTimeout: <T>(p: Promise<T>) => p,
  HOSTED_TRANSPORTS: ['sse', 'streamable-http'],
}));
vi.mock('../src/mcp/telemetry.js', () => ({
  recordToolCall: vi.fn(async () => {}),
}));
vi.mock('../src/auth/middleware.js', () => ({
  identityRequired: vi.fn(() => false),
}));

import { identityRequired } from '../src/auth/middleware.js';
import {
  type AggregateContext,
  NS,
  buildAggregateServer,
  collectTools,
  resolveQualified,
} from '../src/mcp/aggregate.js';
import { recordToolCall } from '../src/mcp/telemetry.js';
import { connectUpstream } from '../src/mcp/upstream.js';
import { allServers, visibleServers } from '../src/registry/index.js';
import { disabledToolNames } from '../src/registry/tools.js';

// biome-ignore lint/suspicious/noExplicitAny: test rows only carry the fields the code reads.
type Row = any;
const row = (slug: string, id = `id-${slug}`, enabled = true): Row => ({ slug, id, enabled });

interface UpstreamTool {
  name: string;
  description?: string;
}

/** A fake MCP upstream client: listTools/callTool/close, keyed off the server slug. */
function fakeUpstream(slug: string, catalog: Record<string, UpstreamTool[]>, callResult?: unknown) {
  return {
    listTools: vi.fn(async () => ({
      tools: (catalog[slug] ?? []).map((t) => ({ inputSchema: { type: 'object' }, ...t })),
    })),
    callTool: vi.fn(async () => callResult ?? { content: [{ type: 'text', text: 'ok' }] }),
    close: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(disabledToolNames).mockResolvedValue(new Set());
  vi.mocked(allServers).mockResolvedValue([]);
  vi.mocked(identityRequired).mockReturnValue(false);
});
afterEach(() => vi.restoreAllMocks());

describe('NS separator', () => {
  it('is the double underscore', () => {
    expect(NS).toBe('__');
  });
});

describe('collectTools — merge + namespacing', () => {
  const catalog: Record<string, UpstreamTool[]> = {
    'rs-mcp': [
      { name: 'search_wiki', description: 'search the wiki' },
      { name: 'get_price', description: 'ge price' },
    ],
    weather: [{ name: 'forecast' }, { name: 'secret_tool' }],
  };

  it('prefixes every tool name with `${slug}__` and tags serverSlug', async () => {
    vi.mocked(visibleServers).mockResolvedValue([row('rs-mcp'), row('weather')]);
    vi.mocked(connectUpstream).mockImplementation(
      // biome-ignore lint/suspicious/noExplicitAny: fake client shape.
      (async (s: Row) => fakeUpstream(s.slug, catalog)) as any,
    );

    const { tools, errors } = await collectTools('u1');

    expect(errors).toEqual([]);
    expect(tools.map((t) => t.name)).toEqual([
      'rs-mcp__search_wiki',
      'rs-mcp__get_price',
      'weather__forecast',
      'weather__secret_tool',
    ]);
    // serverSlug bookkeeping is preserved on the AggregateTool, and descriptions pass through.
    expect(tools[0]).toMatchObject({
      name: 'rs-mcp__search_wiki',
      serverSlug: 'rs-mcp',
      description: 'search the wiki',
    });
    expect(tools[2].serverSlug).toBe('weather');
  });

  it('drops tools disabled by gateway policy, per server', async () => {
    vi.mocked(visibleServers).mockResolvedValue([row('rs-mcp'), row('weather')]);
    vi.mocked(connectUpstream).mockImplementation(
      // biome-ignore lint/suspicious/noExplicitAny: fake client shape.
      (async (s: Row) => fakeUpstream(s.slug, catalog)) as any,
    );
    vi.mocked(disabledToolNames).mockImplementation(async (serverId: string) =>
      serverId === 'id-weather' ? new Set(['secret_tool']) : new Set(),
    );

    const { tools } = await collectTools('u1');
    expect(tools.map((t) => t.name)).toEqual([
      'rs-mcp__search_wiki',
      'rs-mcp__get_price',
      'weather__forecast',
    ]);
  });

  it('isolates a failing upstream into errors[] while others still list', async () => {
    vi.mocked(visibleServers).mockResolvedValue([row('rs-mcp'), row('weather')]);
    vi.mocked(connectUpstream).mockImplementation((async (s: Row) => {
      if (s.slug === 'weather') throw new Error('boom');
      return fakeUpstream(s.slug, catalog);
      // biome-ignore lint/suspicious/noExplicitAny: fake client shape.
    }) as any);

    const { tools, errors } = await collectTools('u1');
    expect(tools.map((t) => t.name)).toEqual(['rs-mcp__search_wiki', 'rs-mcp__get_price']);
    expect(errors).toEqual([{ slug: 'weather', error: 'boom' }]);
  });

  it('returns an empty catalog when no servers are visible', async () => {
    vi.mocked(visibleServers).mockResolvedValue([]);
    const { tools, errors } = await collectTools(null);
    expect(tools).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe('resolveQualified — reverse of namespacing', () => {
  beforeEach(() => {
    vi.mocked(visibleServers).mockResolvedValue([row('rs-mcp'), row('weather')]);
  });

  it('splits a qualified name into { server, toolName }', async () => {
    const r = await resolveQualified('u1', 'rs-mcp__search_wiki');
    expect(r?.server.slug).toBe('rs-mcp');
    expect(r?.toolName).toBe('search_wiki');
  });

  it('keeps a `__` inside the upstream tool name intact', async () => {
    const r = await resolveQualified('u1', 'rs-mcp__do__thing');
    expect(r?.server.slug).toBe('rs-mcp');
    expect(r?.toolName).toBe('do__thing');
  });

  it('longest matching slug wins so one slug cannot shadow another it prefixes', async () => {
    vi.mocked(visibleServers).mockResolvedValue([row('foo'), row('foo__bar')]);
    const r = await resolveQualified('u1', 'foo__bar__baz');
    expect(r?.server.slug).toBe('foo__bar');
    expect(r?.toolName).toBe('baz');
  });

  it('returns null for an unknown slug', async () => {
    expect(await resolveQualified('u1', 'ghost__x')).toBeNull();
  });

  it('returns null for a name with no separator', async () => {
    expect(await resolveQualified('u1', 'searchwiki')).toBeNull();
    expect(await resolveQualified('u1', 'rs-mcp')).toBeNull();
  });
});

// --- full round-trip through the built MCP Server -------------------------------------

async function connectClient(server: Server): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const ctx = (userId: string | null): AggregateContext => ({
  userId,
  bearer: undefined,
  sessionId: () => 'sess-1',
});

describe('buildAggregateServer — tools/list handler', () => {
  it('returns the prefixed catalog and strips serverSlug from the MCP Tool shape', async () => {
    vi.mocked(visibleServers).mockResolvedValue([row('rs-mcp')]);
    vi.mocked(connectUpstream).mockImplementation(
      // biome-ignore lint/suspicious/noExplicitAny: fake client shape.
      (async (s: Row) => fakeUpstream(s.slug, { 'rs-mcp': [{ name: 'search_wiki' }] })) as any,
    );

    const client = await connectClient(buildAggregateServer(ctx('u1')));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['rs-mcp__search_wiki']);
    expect(tools[0]).not.toHaveProperty('serverSlug');
    await client.close();
  });
});

describe('buildAggregateServer — tools/call handler', () => {
  const catalog = { 'rs-mcp': [{ name: 'search_wiki' }] };
  const wireUpstream = (result?: unknown) =>
    vi.mocked(connectUpstream).mockImplementation(
      // biome-ignore lint/suspicious/noExplicitAny: fake client shape.
      (async (s: Row) => fakeUpstream(s.slug, catalog, result)) as any,
    );

  it('refuses anonymous calls when identity is required', async () => {
    vi.mocked(identityRequired).mockReturnValue(true);
    vi.mocked(visibleServers).mockResolvedValue([row('rs-mcp')]);

    const client = await connectClient(buildAggregateServer(ctx(null)));
    const res = await client.callTool({ name: 'rs-mcp__search_wiki' });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0].text).toContain('requires a bearer token');
    await client.close();
  });

  it('reports an unknown qualified name', async () => {
    vi.mocked(visibleServers).mockResolvedValue([row('rs-mcp')]);
    vi.mocked(allServers).mockResolvedValue([row('rs-mcp')]);

    const client = await connectClient(buildAggregateServer(ctx('u1')));
    const res = await client.callTool({ name: 'ghost__x' });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0].text).toContain('Unknown tool "ghost__x"');
    await client.close();
  });

  it('blocks a call to a server disabled by the gateway, and says so distinctly', async () => {
    // Not visible (so resolveQualified misses) but present-and-disabled in allServers.
    vi.mocked(visibleServers).mockResolvedValue([row('rs-mcp')]);
    vi.mocked(allServers).mockResolvedValue([row('rs-mcp'), row('legacy', 'id-legacy', false)]);

    const client = await connectClient(buildAggregateServer(ctx('u1')));
    const res = await client.callTool({ name: 'legacy__foo' });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0].text).toContain(
      'server "legacy" is disabled by the gateway',
    );
    expect(recordToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'blocked', toolName: 'foo', serverId: 'id-legacy' }),
    );
    await client.close();
  });

  it('blocks a call to a disabled tool before touching the upstream', async () => {
    vi.mocked(visibleServers).mockResolvedValue([row('rs-mcp')]);
    vi.mocked(disabledToolNames).mockResolvedValue(new Set(['search_wiki']));
    wireUpstream();

    const client = await connectClient(buildAggregateServer(ctx('u1')));
    const res = await client.callTool({ name: 'rs-mcp__search_wiki' });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0].text).toBe(
      'Tool "search_wiki" is disabled by the gateway.',
    );
    expect(connectUpstream).not.toHaveBeenCalled();
    expect(recordToolCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'blocked' }));
    await client.close();
  });

  it('forwards a permitted call with the UNqualified tool name and records ok', async () => {
    vi.mocked(visibleServers).mockResolvedValue([row('rs-mcp')]);
    const upstreamResult = { content: [{ type: 'text', text: 'wiki says hi' }] };
    const upstream = fakeUpstream('rs-mcp', catalog, upstreamResult);
    // biome-ignore lint/suspicious/noExplicitAny: fake client shape.
    vi.mocked(connectUpstream).mockImplementation((async () => upstream) as any);

    const client = await connectClient(buildAggregateServer(ctx('u1')));
    const res = await client.callTool({ name: 'rs-mcp__search_wiki', arguments: { q: 'dragon' } });

    expect(res.content).toEqual(upstreamResult.content);
    expect(upstream.callTool).toHaveBeenCalledWith({
      name: 'search_wiki',
      arguments: { q: 'dragon' },
    });
    expect(recordToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', toolName: 'search_wiki' }),
    );
    await client.close();
  });
});
