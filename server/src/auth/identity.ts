import type { AuthConfig } from "../config/load.js";

export interface Identity {
  /** The external user id decoded from the token (null when absent/unmapped). */
  userId: string | null;
  /** The full decoded token payload, for debugging / future RBAC claims. */
  claims: Record<string, unknown>;
}

/** Walk a dot-path like "user.id" into a nested object; undefined if any hop misses. */
export function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc !== null && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Decode a JWT's payload segment WITHOUT verifying its signature. This is the
 * mocked v1 path — any JWT-shaped (or bare base64url-JSON) token is accepted so the
 * front end can be exercised. Real verification would slot in before this returns.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  const segment = parts.length >= 2 ? parts[1] : parts[0];
  const json = Buffer.from(segment, "base64url").toString("utf8");
  const parsed = JSON.parse(json);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("token payload is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Resolve a bearer token to an identity using the configured claim mappings.
 * Data-driven: change config/auth.json's `from` path to point at wherever the id
 * lives in the token; no code change required.
 */
export function resolveIdentity(
  token: string | null | undefined,
  cfg: AuthConfig,
): Identity {
  if (!token) return { userId: null, claims: {} };

  // v1: verify:false → decode only. When cfg.verify is true, signature validation
  // (HS* via cfg.secret, or RS*/JWKS via cfg.jwksUri) would run here first.
  const claims = decodeJwtPayload(token);

  const mapped: Record<string, unknown> = {};
  for (const m of cfg.claimMappings) {
    mapped[m.to] = getByPath(claims, m.from);
  }

  const raw = mapped.userId;
  const userId = raw === null || raw === undefined ? null : String(raw);
  return { userId, claims };
}
