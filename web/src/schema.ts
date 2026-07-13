// Turn an MCP tool's JSON Schema into the arguments it accepts.
//
// Every MCP tool declares an `inputSchema` in tools/list — a JSON Schema object whose `properties`
// are the parameters and whose `required` array says which cannot be omitted. The gateway already
// had this on every tool and was discarding it, so the dashboard could tell you a tool existed but
// not how to call it.
//
// Deliberately NOT a schema renderer. It reads the one level that answers "what do I pass?" —
// name, type, whether it is required, and an enum's allowed values, which is usually the whole
// story for an MCP tool. Nested objects degrade to their type rather than expanding into a tree
// nobody wanted inside a table cell.

export interface ToolArg {
  name: string;
  type: string;
  required: boolean;
  /** Present for enums — the allowed values are usually more useful than the word "string". */
  values?: string[];
  description?: string;
}

interface JsonSchemaProp {
  type?: string | string[];
  enum?: unknown[];
  description?: string;
  items?: { type?: string };
}

interface JsonSchema {
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
}

function typeOf(p: JsonSchemaProp): string {
  const t = Array.isArray(p.type) ? p.type.join(" | ") : p.type;
  if (t === "array" && p.items?.type) return `${p.items.type}[]`;
  return t ?? "any";
}

/** Parse a tool's inputSchema. Returns [] when the tool takes no arguments or declares no schema —
 *  those are different facts, and the caller distinguishes them by checking the schema itself. */
export function toolArgs(inputSchema: unknown): ToolArg[] {
  const s = inputSchema as JsonSchema | null | undefined;
  if (!s || typeof s !== "object" || !s.properties) return [];
  const required = new Set(s.required ?? []);
  return Object.entries(s.properties).map(([name, p]) => ({
    name,
    type: typeOf(p),
    required: required.has(name),
    values: Array.isArray(p.enum) ? p.enum.map(String) : undefined,
    description: p.description,
  }));
}
