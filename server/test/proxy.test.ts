import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Characterization tests for the per-server (`/mcp/:slug`) passthrough proxy.
 *
 * The headline difference from the aggregate: tool names here are UNprefixed. The proxy
 * still drops gateway-disabled tools and blocks a disabled call before touching the
 * upstream. DB/telemetry seams are mocked; the upstream client is faked.
 */

vi.mock('../src/registry/tools.js', () => ({
  disabledToolNames: vi.fn(),
}));
vi.mock('../src/mcp/telemetry.js', () => ({
  recordToolCall: vi.fn(async () => {}),
}));

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { buildProxyServer, previewText } from '../src/mcp/proxy.js';
import { recordToolCall } from '../src/mcp/telemetry.js';
import type { ServerRow } from '../src/registry/index.js';
import { disabledToolNames } from '../src/registry/tools.js';

describe('previewText', () => {
  it('joins text parts with newlines', () => {
    const r = {
      content: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
    } as CallToolResult;
    expect(previewText(r)).toBe('a\nb');
  });

  it('ignores non-text content parts', () => {
    const r = {
      content: [
        { type: 'image', data: 'xxx', mimeType: 'image/png' },
        { type: 'text', text: 'only this' },
      ],
    } as unknown as CallToolResult;
    expect(previewText(r)).toBe('only this');
  });

  it('returns undefined when there is no text', () => {
    expect(previewText({ content: [] } as unknown as CallToolResult)).toBeUndefined();
    expect(
      previewText({ content: [{ type: 'text', text: '' }] } as unknown as CallToolResult),
    ).toBeUndefined();
  });

  it('returns undefined when content is not an array', () => {
    expect(previewText({} as CallToolResult)).toBeUndefined();
  });

  it('truncates past 2000 chars with an ellipsis', () => {
    const r = { content: [{ type: 'text', text: 'a'.repeat(2500) }] } as CallToolResult;
    const out = previewText(r);
    expect(out).toBe(`${'a'.repeat(2000)}…`);
    expect(out).toHaveLength(2001);
  });
});

// --- full round-trip through the built proxy MCP Server -------------------------------

// Test row only carries the fields the code reads (id, slug).
const serverRow = { id: 'id-rs', slug: 'rs-mcp' } as unknown as ServerRow;

/** Fake MCP upstream client, cast to Client so call sites need no `any`. */
function fakeUpstream(tools: { name: string }[], callResult?: unknown) {
  const upstream = {
    listTools: vi.fn(async () => ({
      tools: tools.map((t) => ({ inputSchema: { type: 'object' }, ...t })),
    })),
    callTool: vi.fn(async () => callResult ?? { content: [{ type: 'text', text: 'ok' }] }),
    close: vi.fn(async () => {}),
  };
  return { upstream, asClient: upstream as unknown as Client };
}

async function connectClient(server: Server): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.mocked(disabledToolNames).mockResolvedValue(new Set());
});
afterEach(() => vi.restoreAllMocks());

describe('buildProxyServer — tools/list', () => {
  it('passes upstream tool names through UNprefixed, minus disabled ones', async () => {
    vi.mocked(disabledToolNames).mockResolvedValue(new Set(['secret']));
    const { asClient } = fakeUpstream([{ name: 'search' }, { name: 'price' }, { name: 'secret' }]);
    const client = await connectClient(
      buildProxyServer({
        server: serverRow,
        upstream: asClient,
        externalUserId: 'u1',
        sessionId: () => 's1',
      }),
    );

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['search', 'price']);
    await client.close();
  });
});

describe('buildProxyServer — tools/call', () => {
  it('blocks a disabled tool before touching the upstream', async () => {
    vi.mocked(disabledToolNames).mockResolvedValue(new Set(['secret']));
    const { upstream, asClient } = fakeUpstream([{ name: 'secret' }]);
    const client = await connectClient(
      buildProxyServer({
        server: serverRow,
        upstream: asClient,
        externalUserId: 'u1',
        sessionId: () => 's1',
      }),
    );

    const res = await client.callTool({ name: 'secret' });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0].text).toBe('Tool "secret" is disabled by the gateway.');
    expect(upstream.callTool).not.toHaveBeenCalled();
    expect(recordToolCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'blocked' }));
    await client.close();
  });

  it('forwards a permitted call verbatim and records ok', async () => {
    const upstreamResult = { content: [{ type: 'text', text: 'hello' }] };
    const { upstream, asClient } = fakeUpstream([{ name: 'search' }], upstreamResult);
    const client = await connectClient(
      buildProxyServer({
        server: serverRow,
        upstream: asClient,
        externalUserId: 'u1',
        sessionId: () => 's1',
      }),
    );

    const res = await client.callTool({ name: 'search', arguments: { q: 'x' } });
    expect(res.content).toEqual(upstreamResult.content);
    expect(upstream.callTool).toHaveBeenCalledWith({ name: 'search', arguments: { q: 'x' } });
    expect(recordToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', toolName: 'search' }),
    );
    await client.close();
  });
});
