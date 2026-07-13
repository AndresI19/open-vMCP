import { describe, it, expect } from "vitest";
import { resolveIdentity, getByPath, decodeJwtPayload } from "../src/auth/identity.js";
import { parseAuthConfig } from "../src/config/load.js";

/** Build a JWT-shaped token (header.payload.sig) with an unsigned payload. */
function makeToken(payload: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.`;
}

describe("getByPath", () => {
  it("walks nested dot-paths", async () => {
    expect(getByPath({ user: { id: "andres" } }, "user.id")).toBe("andres");
  });
  it("returns undefined when a hop is missing", async () => {
    expect(getByPath({ user: {} }, "user.id")).toBeUndefined();
    expect(getByPath({}, "user.id")).toBeUndefined();
  });
});

describe("decodeJwtPayload", () => {
  it("decodes the payload segment without verifying", async () => {
    expect(decodeJwtPayload(makeToken({ user: "zezima" }))).toEqual({ user: "zezima" });
  });
  it("accepts a bare base64url payload (no dots)", async () => {
    const bare = Buffer.from(JSON.stringify({ user: "x" })).toString("base64url");
    expect(decodeJwtPayload(bare)).toEqual({ user: "x" });
  });
});

describe("resolveIdentity", () => {
  const flat = parseAuthConfig({ claimMappings: [{ from: "user", to: "userId" }] });
  const nested = parseAuthConfig({ claimMappings: [{ from: "user.id", to: "userId" }] });

  it("maps a flat `user` claim to userId", async () => {
    expect((await resolveIdentity(makeToken({ user: "andres" }), flat)).userId).toBe("andres");
  });

  it("maps a nested `user.id` claim to userId", async () => {
    expect((await resolveIdentity(makeToken({ user: { id: "zezima" } }), nested)).userId).toBe("zezima");
  });

  it("coerces non-string ids to string", async () => {
    expect((await resolveIdentity(makeToken({ user: 42 }), flat)).userId).toBe("42");
  });

  it("no token → null userId", async () => {
    expect((await resolveIdentity(null, flat)).userId).toBeNull();
    expect((await resolveIdentity(undefined, flat)).userId).toBeNull();
  });

  it("token present but claim missing → null userId", async () => {
    expect((await resolveIdentity(makeToken({ sub: "nope" }), flat)).userId).toBeNull();
  });
});
