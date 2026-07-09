import "express";

// Fields the auth middleware attaches to every request.
declare global {
  namespace Express {
    interface Request {
      /** External user id decoded from the bearer token (null if none). */
      userId?: string | null;
      /** The raw bearer token, for optional forwarding upstream. */
      bearer?: string;
    }
  }
}

export {};
