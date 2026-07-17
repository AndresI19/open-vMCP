import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { configDir } from '../paths.js';

/** A single "where the value lives in the token" → "internal field" mapping. */
export const claimMappingSchema = z.object({
  from: z.string().min(1), // dot-path into the token payload, e.g. "user" or "user.id"
  to: z.string().min(1), // internal schema placement, e.g. "userId"
});

/**
 * Data-driven auth config. The shape carries every field real validation needs, so switching between
 * decode-only (verify:false) and verified/OAuth is a config change, not a code change.
 */
export const authConfigSchema = z.object({
  scheme: z.literal('bearer').default('bearer'),
  verify: z.boolean().default(false),
  secret: z.string().optional(), // HS* shared secret (when verify:true)
  jwksUri: z.string().url().optional(), // RS*/JWKS endpoint (when verify:true)
  // Checked in verification, not decoration: a signature proves a token genuine, these prove it was
  // minted for US — without them a valid token for a different audience would be accepted.
  issuer: z.string().optional(),
  audience: z.string().optional(),
  claimMappings: z.array(claimMappingSchema).min(1),
  onMissing: z.enum(['reject', 'anonymous']).default('reject'),
});

export type AuthConfig = z.infer<typeof authConfigSchema>;

let cached: AuthConfig | null = null;

/** Load + validate config/auth.json (memoized). */
export function loadAuthConfig(dir = configDir()): AuthConfig {
  if (cached) return cached;
  const file = resolve(dir, 'auth.json');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  cached = authConfigSchema.parse(raw);
  return cached;
}

/** Validate a raw config object (used by tests and callers holding literals). */
export function parseAuthConfig(raw: unknown): AuthConfig {
  return authConfigSchema.parse(raw);
}
