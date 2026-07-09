import { useState } from "react";
import { Toggle, Tag } from "@carbon/react";

interface Props {
  /** Stable DOM id — Carbon requires one per Toggle. */
  id: string;
  /** What the switch acts on, e.g. "servers" or "tools". */
  noun: string;
  /** Rows the switch can act on (rows it cannot reach are excluded by the caller). */
  total: number;
  /** How many of those are currently on. */
  enabledCount: number;
  disabled?: boolean;
  /** Apply the new state to every eligible row. Awaited so the switch can show progress. */
  onSet: (enabled: boolean) => Promise<void>;
}

/**
 * One switch that trips all the switches below it.
 *
 * Carbon's Toggle has no indeterminate state, so a partial selection reads as OFF and is
 * called out with a "mixed" tag plus an n-of-m count. That keeps the action unambiguous:
 * unless everything is already on, flipping it turns everything on.
 */
export default function MasterToggle({
  id,
  noun,
  total,
  enabledCount,
  disabled,
  onSet,
}: Props) {
  const [busy, setBusy] = useState(false);

  const allOn = total > 0 && enabledCount === total;
  const mixed = enabledCount > 0 && enabledCount < total;
  const inert = disabled || total === 0 || busy;

  async function flip() {
    setBusy(true);
    try {
      await onSet(!allOn);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      <Toggle
        id={id}
        size="sm"
        toggled={allOn}
        disabled={inert}
        labelA=""
        labelB=""
        aria-label={allOn ? `Disable all ${noun}` : `Enable all ${noun}`}
        onToggle={flip}
      />
      <span style={{ fontWeight: 600 }}>
        {allOn ? `Disable all ${noun}` : `Enable all ${noun}`}
      </span>
      <span style={{ color: "var(--cds-text-secondary)" }}>
        {enabledCount} of {total} enabled
      </span>
      {mixed && <Tag type="teal">mixed</Tag>}
    </div>
  );
}
