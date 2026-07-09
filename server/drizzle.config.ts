import { config } from "dotenv";
import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs with cwd = server/, but .env lives at the repo root.
config({ path: [resolve(process.cwd(), "../.env"), resolve(process.cwd(), ".env")] });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
