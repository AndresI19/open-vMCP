import type { Request, Response, NextFunction } from "express";
import { loadAuthConfig } from "../config/load.js";
import { resolveIdentity } from "./identity.js";

/**
 * Reads the (mocked) bearer token, maps it to a userId via the data-driven config,
 * and attaches { userId, bearer } to the request. Never rejects: resolving an identity
 * and demanding one are separate steps, so a route can be readable-while-anonymous
 * (the aggregate catalog) without also being callable-while-anonymous.
 */
export function identityMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const cfg = loadAuthConfig();
  const header = req.headers["authorization"];
  const token =
    typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : undefined;

  let userId: string | null = null;
  try {
    userId = resolveIdentity(token, cfg).userId;
  } catch {
    userId = null; // malformed token → treated as missing
  }

  req.userId = userId;
  req.bearer = token;
  next();
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
