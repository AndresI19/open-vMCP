import { Tag } from "@carbon/react";

/**
 * How a tool call is rendered. Shared, because it was not: Recent Calls decided a call's colour with
 * `status === "ok" ? "green" : "red"` while Server Detail had a three-way `statusColor()`. Telemetry
 * emits THREE statuses — "ok", "error" and "blocked" — so the same blocked call showed up neutral on
 * one page and as a red failure on the other. A policy-blocked tool is not an error; the gateway did
 * exactly what it was told to do.
 */
export type CallStatus = "ok" | "error" | "blocked" | (string & {});

const STATUS_TAG: Record<string, "green" | "red" | "warm-gray"> = {
  ok: "green",
  blocked: "warm-gray",
  error: "red",
};

export function StatusTag({ status }: { status: CallStatus }) {
  // Anything unrecognised is treated as a failure rather than silently rendered green.
  return <Tag type={STATUS_TAG[status] ?? "red"}>{status}</Tag>;
}

/** Placeholder for an absent value. One dash, so the tables do not disagree about which dash. */
export const DASH = "—";

export const fmtTime = (iso: string): string => new Date(iso).toLocaleTimeString();

export const fmtLatency = (ms: number | null): string => (ms != null ? `${ms} ms` : DASH);
