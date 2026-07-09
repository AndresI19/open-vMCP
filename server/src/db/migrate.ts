import "../env.js";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { resolve } from "node:path";
import { repoRoot } from "../paths.js";

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

await migrate(db, { migrationsFolder: resolve(repoRoot, "server/drizzle") });
await pool.end();
console.log("✓ migrations applied");
