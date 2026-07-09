import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

/** Registry of upstream MCP servers the gateway can front (the data-driven part). */
export const mcpServers = pgTable("mcp_servers", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  // Remote upstreams carry a url; stdio upstreams carry command + args instead.
  url: text("url"),
  // "sse" | "streamable-http" (remote) | "stdio" (spawned subprocess).
  transport: text("transport").notNull().default("sse"),
  command: text("command"),
  args: jsonb("args").$type<string[]>(),
  enabled: boolean("enabled").notNull().default(true),
  // Whether to forward the client's bearer token upstream (RS server ignores it).
  forwardAuth: boolean("forward_auth").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Users, keyed by the external id decoded from the (mocked) bearer token. */
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  externalId: text("external_id").notNull().unique(),
  displayName: text("display_name"),
  firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * RBAC join: which users may see which servers. Present from day one but unused by
 * the v1 open policy — visibleServers(userId) starts consulting it when RBAC lands.
 */
export const userServerAccess = pgTable(
  "user_server_access",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    serverId: uuid("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.serverId] })],
);

/** One row per proxied tools/call — the telemetry the dashboard renders. */
export const toolCalls = pgTable(
  "tool_calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serverId: uuid("server_id").references(() => mcpServers.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    sessionId: text("session_id"),
    toolName: text("tool_name").notNull(),
    arguments: jsonb("arguments"),
    argsRedacted: boolean("args_redacted").notNull().default(false),
    status: text("status").notNull(), // "ok" | "error"
    errorMessage: text("error_message"),
    latencyMs: integer("latency_ms"),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    resultPreview: text("result_preview"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tool_calls_server_idx").on(t.serverId),
    index("tool_calls_user_idx").on(t.userId),
    index("tool_calls_tool_idx").on(t.toolName),
    index("tool_calls_created_idx").on(t.createdAt),
  ],
);

/**
 * Per-tool gateway policy. A row means an explicit setting; absence = enabled.
 * When enabled=false the proxy hides the tool from tools/list and blocks tools/call.
 */
export const toolSettings = pgTable(
  "tool_settings",
  {
    serverId: uuid("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.serverId, t.toolName] })],
);

/** One row per downstream MCP session (Claude connection) for context on calls. */
export const mcpSessions = pgTable("mcp_sessions", {
  id: text("id").primaryKey(),
  serverId: uuid("server_id").references(() => mcpServers.id, { onDelete: "set null" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  clientInfo: jsonb("client_info"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
});
