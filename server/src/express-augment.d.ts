import "express";

// Fields the auth middleware attaches to every request.
declare global {
  namespace Express {
    interface Request {
      /** External user id decoded from the bearer token (null if none). */
      userId?: string | null;
      /** The raw bearer token, for optional forwarding upstream. */
      bearer?: string;
      /** Elevated. Comes from a SIGNED claim, minted by the auth service from a list this service
       *  cannot read — never from anything the caller asserted about themselves. */
      isAdmin?: boolean;
    }
  }
}

export {};
