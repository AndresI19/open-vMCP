import { type JWTPayload, createRemoteJWKSet, jwtVerify } from 'jose';
import type { AuthConfig } from '../config/load.js';

/**
 * Real signature verification. Until now this did not exist — and its absence was a trap.
 *
 * config/auth.json has always had a `verify` flag, and setting it to `true` changed NOTHING: the
 * code decoded the token and mapped its claims either way. A flag that reads as "this is secured"
 * and does nothing is worse than no flag at all, because it is precisely the thing a reviewer
 * glances at and moves on from. The comment in identity.ts said verification "would slot in here",
 * which is honest, and this is that slot.
 *
 * The verifier holds only the PUBLIC key, fetched from the auth service's JWKS endpoint. It cannot
 * mint a token, only check one — which is the whole reason the platform signs with RS256 rather than
 * sharing an HS256 secret with every service that needs to read an identity.
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
 * Verify a token's signature and its issuer/audience, returning the claims.
 *
 * Throws on any failure — an expired token, a bad signature, the wrong issuer, `alg: none`. The
 * caller turns that into "anonymous", which is the safe direction: a token we cannot vouch for
 * grants nothing.
 */
export async function verifyToken(token: string, cfg: AuthConfig): Promise<JWTPayload> {
  if (!cfg.jwksUri) {
    // Refusing to run rather than silently falling back to decode-only. A deployment that asked for
    // verification and did not say where the keys live is misconfigured, and pretending otherwise is
    // how you end up believing you are verifying when you are not.
    throw new Error('auth.verify is true but auth.jwksUri is not set');
  }

  const { payload } = await jwtVerify(token, jwkSet(cfg.jwksUri), {
    issuer: cfg.issuer,
    audience: cfg.audience,
    // Only RS256. Left open, `jose` would honour whatever the token's own header asked for — and a
    // token can ask for `none`. Pinning the algorithm here is what stops a forged header from
    // choosing its own verification rules.
    algorithms: ['RS256'],
  });

  return payload;
}
