import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Session, broadcastToolListChanged, sessions } from '../src/mcp/sessions.js';

/**
 * Characterization tests for the session registry's tools/list_changed broadcast.
 *
 * Pins the target-selection rule (which sessions get notified for a given slug), the
 * delivered-count return value, and the best-effort semantics (a rejecting session must
 * not fail the broadcast). The transport/server are faked; no MCP connection is opened.
 */

interface FakeSession {
  slug: string | null;
  notify: ReturnType<typeof vi.fn>;
}

/** Insert a fake session into the shared map and return the handle for assertions. */
function addSession(id: string, slug: string | null, reject = false): FakeSession {
  const notify = reject
    ? vi.fn().mockRejectedValue(new Error('no open stream'))
    : vi.fn().mockResolvedValue(undefined);
  const session = { slug, server: { sendToolListChanged: notify } } as unknown as Session;
  sessions.set(id, session);
  return { slug, notify };
}

beforeEach(() => {
  sessions.clear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  sessions.clear();
  vi.restoreAllMocks();
});

describe('broadcastToolListChanged', () => {
  it('notifies every session when no slug is given', async () => {
    const agg = addSession('a', null);
    const proxyA = addSession('b', 'a');
    const proxyB = addSession('c', 'b');

    const delivered = await broadcastToolListChanged();

    expect(delivered).toBe(3);
    expect(agg.notify).toHaveBeenCalledTimes(1);
    expect(proxyA.notify).toHaveBeenCalledTimes(1);
    expect(proxyB.notify).toHaveBeenCalledTimes(1);
  });

  it('notifies only aggregate sessions and the matching slug when a slug is given', async () => {
    const agg = addSession('a', null);
    const proxyA = addSession('b', 'a');
    const proxyB = addSession('c', 'b');

    const delivered = await broadcastToolListChanged('a');

    expect(delivered).toBe(2);
    expect(agg.notify).toHaveBeenCalledTimes(1);
    expect(proxyA.notify).toHaveBeenCalledTimes(1);
    expect(proxyB.notify).not.toHaveBeenCalled();
  });

  it('counts only fulfilled deliveries and never throws on a rejecting session', async () => {
    addSession('a', null); // resolves
    addSession('b', 'a', true); // rejects

    const delivered = await broadcastToolListChanged('a');

    expect(delivered).toBe(1);
  });

  it('returns 0 when there are no sessions', async () => {
    expect(await broadcastToolListChanged()).toBe(0);
    expect(await broadcastToolListChanged('anything')).toBe(0);
  });
});
