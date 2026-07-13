import { generateKeyPairSync } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { parseAuthConfig } from "../src/config/load.js";
import { resolveIdentity } from "../src/auth/identity.js";

/**
 * The tests that could not have existed before, because the behaviour did not.
 *
 * `verify: true` used to change nothing: the token was decoded either way, and a forged token was as
 * good as a real one. These assert the opposite, which is the entire point of the change.
 */

const issuer = "https://auth.test/auth";
const audience = "platform";

const real = generateKeyPairSync("rsa", { modulusLength: 2048 });
const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });

const pem = (k: typeof real.privateKey) => k.export({ type: "pkcs8", format: "pem" }).toString();

async function sign(key: typeof real.privateKey, claims: Record<string, unknown>, exp = "1h") {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(await importPKCS8(pem(key), "RS256"));
}

// Serve the REAL key's public half as a JWKS, the way the auth service does.
//
// The public JWK comes from Node's own key object rather than jose's exportJWK: importPKCS8 returns
// a NON-EXTRACTABLE CryptoKey, which can sign but cannot be exported. That is a sensible default for
// a signing key and a trap for anyone trying to publish its public half.
beforeAll(async () => {
  const jwk = real.publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  const body = JSON.stringify({ keys: [{ ...jwk, alg: "RS256", use: "sig" }] });
  vi.stubGlobal("fetch", async () =>
    new Response(body, { status: 200, headers: { "content-type": "application/jwk-set+json" } }),
  );
});
afterAll(() => vi.unstubAllGlobals());

const verifying = parseAuthConfig({
  verify: true,
  jwksUri: "https://auth.test/.well-known/jwks.json",
  issuer,
  audience,
  claimMappings: [{ from: "sub", to: "userId" }],
});

describe("verify: true", () => {
  it("accepts a token the auth service actually signed", async () => {
    const token = await sign(real.privateKey, { sub: "user-1", handle: "K7R2M" });
    const id = await resolveIdentity(token, verifying);
    expect(id.userId).toBe("user-1");
    expect(id.claims.handle).toBe("K7R2M");
  });

  it("REJECTS a token signed by somebody else's key", async () => {
    const forged = await sign(attacker.privateKey, { sub: "user-1" });
    await expect(resolveIdentity(forged, verifying)).rejects.toThrow();
  });

  it("REJECTS an unsigned token — the `alg: none` trick", async () => {
    // The classic JWT attack: strip the signature and tell the verifier not to check one. It works
    // against any implementation that trusts the token's own header to choose the algorithm, which
    // is why verify.ts pins algorithms: ["RS256"] rather than leaving it open.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ sub: "admin", iss: issuer, aud: audience })).toString("base64url");
    await expect(resolveIdentity(`${header}.${body}.`, verifying)).rejects.toThrow();
  });

  it("REJECTS an expired token", async () => {
    const stale = await sign(real.privateKey, { sub: "user-1" }, "-1s");
    await expect(resolveIdentity(stale, verifying)).rejects.toThrow();
  });

  it("REJECTS a genuine token minted for a different audience", async () => {
    // A real signature is not enough. It proves the token came from the issuer; it does not prove it
    // was meant for US.
    const elsewhere = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(issuer)
      .setAudience("some-other-service")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(await importPKCS8(pem(real.privateKey), "RS256"));
    await expect(resolveIdentity(elsewhere, verifying)).rejects.toThrow();
  });

  it("refuses to run at all if asked to verify with no key source", async () => {
    // Silently falling back to decode-only here would be the worst possible behaviour: the operator
    // asked for verification and would believe they had it.
    const misconfigured = parseAuthConfig({
      verify: true,
      claimMappings: [{ from: "sub", to: "userId" }],
    });
    const token = await sign(real.privateKey, { sub: "user-1" });
    await expect(resolveIdentity(token, misconfigured)).rejects.toThrow(/jwksUri/);
  });
});

describe("verify: false (the mocked path, unchanged)", () => {
  it("still decodes without checking, so the dashboard can be exercised offline", async () => {
    const mocked = parseAuthConfig({ claimMappings: [{ from: "user", to: "userId" }] });
    const bare = Buffer.from(JSON.stringify({ user: "andres" })).toString("base64url");
    const id = await resolveIdentity(bare, mocked);
    expect(id.userId).toBe("andres");
  });
});
