// Load the repo-root .env regardless of which workspace cwd invoked us.
// Import this module first (for its side effect) in every entry point.
import { config } from "dotenv";
import { resolve } from "node:path";
import { repoRoot } from "./paths.js";

config({ path: resolve(repoRoot, ".env") });
