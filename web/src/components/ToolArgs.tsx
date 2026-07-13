import { Tag } from "@carbon/react";
import { toolArgs } from "../schema";

/**
 * The arguments a tool accepts, read from the MCP `inputSchema` the upstream already declares.
 *
 * Required arguments come first and are marked — that is the one thing a caller has to get right,
 * and burying it in alphabetical order with the optionals would make the column decorative. An
 * enum's allowed values are shown instead of its type, because "rs3 | osrs" tells you how to call
 * the tool and "string" does not.
 *
 * A tool with a schema that declares no properties genuinely takes no arguments; a tool with no
 * schema at all is an upstream that did not say. Those are different facts and the cell says which.
 */
export default function ToolArgs({ inputSchema }: { inputSchema: unknown }) {
  const args = toolArgs(inputSchema);
  const muted = { color: "var(--cds-text-secondary)", fontSize: "0.8rem" };

  if (!inputSchema) return <span style={muted}>not declared</span>;
  if (args.length === 0) return <span style={muted}>none</span>;

  const sorted = [...args].sort((a, b) => Number(b.required) - Number(a.required));

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", maxWidth: 360 }}>
      {sorted.map((a) => (
        <Tag
          key={a.name}
          type={a.required ? "blue" : "gray"}
          size="sm"
          title={a.description ?? undefined}
        >
          <code style={{ fontWeight: a.required ? 600 : 400 }}>{a.name}</code>
          {a.required && <span aria-label="required">*</span>}
          <span style={{ opacity: 0.7 }}>
            {" "}
            {a.values ? a.values.join(" | ") : a.type}
          </span>
        </Tag>
      ))}
    </div>
  );
}
