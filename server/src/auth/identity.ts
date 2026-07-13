import type { AuthConfig } from "../config/load.js";
import { verifyToken } from "./verify.js";

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
 * Decode a JWT's payload segment WITHOUT verifying its signature.
 *
 * This is the MOCKED path, used only when config/auth.json has `verify: false`. Any JWT-shaped (or
 * bare base64url-JSON) token is accepted, which is what let the dashboard be built before an auth
 * service existed. It is not a fallback and it is not a degraded mode — with `verify: true` this
 * function is never reached. See verify.ts.
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
 * Data-driven: change config/auth.json's `from` path to point at wherever the id lives in the token;
 * no code change required.
 *
 * ASYNC, because verification is: fetching the issuer's public keys is a network call. That is why
 * this could not simply be bolted on to the old synchronous function — the signature had to change,
 * and every caller with it. A "verify" flag that could be honoured without touching the call graph
 * would have been a verify flag that was not really verifying.
 */
export async function resolveIdentity(
  token: string | null | undefined,
  cfg: AuthConfig,
): Promise<Identity> {
  if (!token) return { userId: null, claims: {} };

  // The fork the `verify` flag was always supposed to control, and until now did not.
  const claims: Record<string, unknown> = cfg.verify
    ? ((await verifyToken(token, cfg)) as Record<string, unknown>)
    : decodeJwtPayload(token);

  const mapped: Record<string, unknown> = {};
  for (const m of cfg.claimMappings) {
    mapped[m.to] = getByPath(claims, m.from);
  }

  const raw = mapped.userId;
  const userId = raw === null || raw === undefined ? null : String(raw);
  return { userId, claims };
}
