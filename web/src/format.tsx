import { Tag } from '@carbon/react';

/**
 * How a tool call is rendered, shared so pages agree. Telemetry emits THREE statuses — "ok", "error",
 * "blocked" — and a policy-blocked tool is NOT an error: without this, a blocked call showed neutral
 * on one page and red on another.
 */
export type CallStatus = 'ok' | 'error' | 'blocked' | (string & {});

const STATUS_TAG: Record<string, 'green' | 'red' | 'warm-gray'> = {
  ok: 'green',
  blocked: 'warm-gray',
  error: 'red',
};

export function StatusTag({ status }: { status: CallStatus }) {
  // Anything unrecognised is treated as a failure rather than silently rendered green.
  return <Tag type={STATUS_TAG[status] ?? 'red'}>{status}</Tag>;
}

/** Placeholder for an absent value. One dash, so the tables do not disagree about which dash. */
export const DASH = '—';

export const fmtTime = (iso: string): string => new Date(iso).toLocaleTimeString();

export const fmtLatency = (ms: number | null): string => (ms != null ? `${ms} ms` : DASH);
