/**
 * Build an unsigned (alg:none) bearer for local dev, one source of truth for the CLI helpers.
 *
 * This replaces the removed `/auth/mock-token` minter that call.ts and populate.ts used to fetch: with
 * verification ON that endpoint could only mint tokens the gateway rejects, so it was deleted and these
 * scripts fetched a 404. The gateway decodes this token only with `auth.verify: false` (decode-only,
 * local mode) — mirroring scripts/e2e-smoke.ts's built-in `{ user: "andres" }` token — carrying the
 * `user` claim the local claim-mapping reads. Never valid against a verifying deploy.
 */
export function mockToken(user: string): string {
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({ user })}.`;
}
