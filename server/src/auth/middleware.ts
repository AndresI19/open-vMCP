import type { NextFunction, Request, Response } from 'express';
import { loadAuthConfig } from '../config/load.js';
import { ensureUser } from '../db/users.js';
import { resolveIdentity } from './identity.js';

/**
 * Read the bearer token, map it to a userId via the data-driven config, attach { userId, bearer }.
 * Never rejects: resolving an identity and demanding one are separate steps, so a route can be
 * readable-while-anonymous (the aggregate catalog) without being callable-while-anonymous.
 */
export async function identityMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const cfg = loadAuthConfig();
  const header = req.headers.authorization;
  const token =
    typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : undefined;

  let userId: string | null = null;
  try {
    const id = await resolveIdentity(token, cfg);
    userId = id.userId;

    // Upsert the USERNAME here, at authentication, not at tool-call time. The dashboard's User column
    // shows this row, and a `sub` is a correct-but-useless UUID; the username is the safe-to-display
    // part. Doing it in middleware lands it on ANY authenticated request (not just tool calls) without
    // threading a parameter through the nine record sites. Idempotent upsert, fire-and-forget: its
    // failure must never fail the request.
    const displayName = id.claims.username;
    if (userId && typeof displayName === 'string') {
      void ensureUser(userId, displayName).catch(() => {});
    }

    // The role rides in the token, SIGNED — not looked up here, and it couldn't be: the admin list is
    // a secret the auth service holds and this one does not. The gateway enforces a policy it can't read.
    req.isAdmin = id.claims.admin === true;
  } catch {
    // A token we can't vouch for grants NOTHING. Malformed, expired, wrong issuer, forged all land
    // here and become "anonymous" — the safe direction: requireIdentity then turns the caller away.
    userId = null;
  }

  req.userId = userId;
  req.bearer = token;
  next();
}

/**
 * Writes require an admin. REPLACES the nginx `limit_except GET HEAD OPTIONS` stopgap — a
 * routing-layer control you bypass by bypassing nginx, and one that couldn't read a JWT to tell an
 * admin apart (so even the admin couldn't write). The check now lives in the thing being protected,
 * on a signed claim. Reads stay open — the dashboard is meant to be looked at.
 */
export function requireAdminForWrites(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  if (req.isAdmin) {
    next();
    return;
  }
  res
    .status(req.userId ? 403 : 401)
    .set('WWW-Authenticate', 'Bearer realm="vmcp"')
    .json({
      error: req.userId ? 'forbidden: this action needs an admin' : 'sign in as an admin to change anything',
    });
}

/** Whether an anonymous caller must be turned away, per config/auth.json `onMissing`. */
export function identityRequired(): boolean {
  return loadAuthConfig().onMissing === 'reject';
}

/** Guard for routes that act on a user's behalf: tool execution and per-server proxying. */
export function requireIdentity(req: Request, res: Response, next: NextFunction): void {
  if (!req.userId && identityRequired()) {
    res
      .status(401)
      .set('WWW-Authenticate', 'Bearer realm="vmcp", error="invalid_token"')
      .json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized: missing or unmapped bearer token' },
        id: null,
      });
    return;
  }

  next();
}
