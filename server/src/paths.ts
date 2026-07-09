import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// This file lives at server/src/paths.ts (dev, run via tsx) or server/dist/paths.js
// (built). In both cases the repo root is two directories up from here.
const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the vmcp-gateway repo root, independent of the caller's cwd. */
export const repoRoot = resolve(here, "../../");

/** Absolute path to the config/ directory (override with CONFIG_DIR, relative to root). */
export function configDir(): string {
  return resolve(repoRoot, process.env.CONFIG_DIR ?? "config");
}
