import { type JWTPayload, createRemoteJWKSet, jwtVerify } from 'jose';
import type { AuthConfig } from '../config/load.js';

/**
 * Real JWT signature verification (the slot the `verify` flag was always meant to fill).
 *
 * The verifier holds only the PUBLIC key, fetched from the auth service's JWKS endpoint: it can check
 * a token, not mint one — which is why the platform signs with RS256 rather than sharing an HS256
 * secret with every service that reads an identity.
 */

// One JWKS client per URI, kept for the process's life. `jose` caches the keys, refetches on an
// unknown `kid` (which is how a rotated signing key is picked up without a redeploy), and rate-limits
// its own refetches so an attacker cannot make us hammer the auth service by sending junk kids.
const sets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwkSet(uri: string): ReturnType<typeof createRemoteJWKSet> {
  let s = sets.get(uri);
  if (!s) {
    s = createRemoteJWKSet(new URL(uri), {
      cacheMaxAge: 10 * 60_000,
      cooldownDuration: 30_000,
    });
    sets.set(uri, s);
  }
  return s;
}

/**
 * Verify a token's signature, issuer and audience, returning the claims. Throws on any failure
 * (expired, bad signature, wrong issuer, `alg: none`); the caller turns that into "anonymous".
 */
export async function verifyToken(token: string, cfg: AuthConfig): Promise<JWTPayload> {
  if (!cfg.jwksUri) {
    // Refuse to run rather than silently fall back to decode-only: a deploy that asked for
    // verification but didn't say where the keys live is misconfigured, and pretending otherwise is
    // how you end up believing you verify when you don't.
    throw new Error('auth.verify is true but auth.jwksUri is not set');
  }

  const { payload } = await jwtVerify(token, jwkSet(cfg.jwksUri), {
    issuer: cfg.issuer,
    audience: cfg.audience,
    // Only RS256. Left open, `jose` honours whatever the token's own header asks for — including
    // `none`. Pinning the algorithm stops a forged header from choosing its own verification rules.
    algorithms: ['RS256'],
  });

  return payload;
}
