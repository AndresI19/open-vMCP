import "../env.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { configDir } from "../paths.js";
import { db, pool } from "./client.js";
import { mcpServers } from "./schema.js";

interface SeedServer {
  slug: string;
  name: string;
  url: string;
  transport: string;
  enabled: boolean;
  forwardAuth?: boolean;
}

const file = resolve(configDir(), "servers.seed.json");
const parsed = JSON.parse(readFileSync(file, "utf8")) as { servers: SeedServer[] };

/** Per-slug URL override, e.g. SEED_URL_RS_MCP rewrites rs-mcp for a container network. */
function urlFor(slug: string, fallback: string): string {
  const key = `SEED_URL_${slug.toUpperCase().replace(/-/g, "_")}`;
  return process.env[key] ?? fallback;
}

for (const s of parsed.servers) {
  const url = urlFor(s.slug, s.url);
  await db
    .insert(mcpServers)
    .values({
      slug: s.slug,
      name: s.name,
      url,
      transport: s.transport,
      enabled: s.enabled,
      forwardAuth: s.forwardAuth ?? false,
    })
    .onConflictDoUpdate({
      target: mcpServers.slug,
      set: {
        name: s.name,
        url,
        transport: s.transport,
        enabled: s.enabled,
        forwardAuth: s.forwardAuth ?? false,
        updatedAt: sql`now()`,
      },
    });
  console.log(`✓ seeded server: ${s.slug} → ${url}`);
}

await pool.end();
