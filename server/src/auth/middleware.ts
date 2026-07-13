import type { Request, Response, NextFunction } from "express";
import { loadAuthConfig } from "../config/load.js";
import { ensureUser } from "../db/users.js";
import { resolveIdentity } from "./identity.js";

/**
 * Reads the (mocked) bearer token, maps it to a userId via the data-driven config,
 * and attaches { userId, bearer } to the request. Never rejects: resolving an identity
 * and demanding one are separate steps, so a route can be readable-while-anonymous
 * (the aggregate catalog) without also being callable-while-anonymous.
 */
export async function identityMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const cfg = loadAuthConfig();
  const header = req.headers["authorization"];
  const token =
    typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : undefined;

  let userId: string | null = null;
  try {
    const id = await resolveIdentity(token, cfg);
    userId = id.userId;

    // Record the USERNAME here, at the moment of authentication, rather than at the moment of a tool
    // call. The dashboard's User column shows whatever this row holds — and a `sub` is a UUID, which
    // is a correct identity and a useless thing to read. The username is what the user chose and the
    // only part of their identity that is safe to display.
    //
    // Doing it in the middleware rather than in telemetry.ts also means it lands on ANY authenticated
    // request, not only on a tool call, and it does not require threading a parameter through the
    // nine places that record one. It is an idempotent upsert; its failure must never fail the
    // request, so it is fire-and-forget.
    const displayName = id.claims["username"];
    if (userId && typeof displayName === "string") {
      void ensureUser(userId, displayName).catch(() => {});
    }

    // The role rides in the token, SIGNED. It is not looked up here, and it could not be: the admin
    // list is a secret the auth service holds and this service does not. That is the point — the
    // gateway enforces a policy it is not allowed to read.
    req.isAdmin = id.claims["admin"] === true;
  } catch {
    // A token we cannot vouch for grants NOTHING. Malformed, expired, wrong issuer, forged — they all
    // land here and all become "anonymous", which is the safe direction: the caller then meets
    // requireIdentity and is turned away, rather than being quietly trusted.
    userId = null;
  }

  req.userId = userId;
  req.bearer = token;
  next();
}

/**
 * Writes require an admin.
 *
 * This REPLACES the nginx `limit_except GET HEAD OPTIONS` that used to guard the public dashboard.
 * That was always a stopgap and was documented as one: a routing-layer control, not an application
 * one — bypass nginx and you bypass the control. It also could not tell an admin from anyone else,
 * because it cannot read a JWT, so with it in place the admin could not write from the public site
 * either.
 *
 * Now the check is where it belongs: in the thing being protected, on a signed claim.
 *
 * Reads stay open. The dashboard is meant to be looked at.
 */
export function requireAdminForWrites(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  if (req.isAdmin) {
    next();
    return;
  }
  res
    .status(req.userId ? 403 : 401)
    .set("WWW-Authenticate", 'Bearer realm="vmcp"')
    .json({
      error: req.userId ? "forbidden: this action needs an admin" : "sign in as an admin to change anything",
    });
}

/** Whether an anonymous caller must be turned away, per config/auth.json `onMissing`. */
export function identityRequired(): boolean {
  return loadAuthConfig().onMissing === "reject";
}

/** Guard for routes that act on a user's behalf: tool execution and per-server proxying. */
export function requireIdentity(req: Request, res: Response, next: NextFunction): void {
  if (!req.userId && identityRequired()) {
    res
      .status(401)
      .set("WWW-Authenticate", 'Bearer realm="vmcp", error="invalid_token"')
      .json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: missing or unmapped bearer token" },
        id: null,
      });
    return;
  }

  next();
}
