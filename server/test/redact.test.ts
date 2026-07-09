import { describe, it, expect } from "vitest";
import { redactArgs } from "../src/mcp/redact.js";

describe("redactArgs", () => {
  it("passes through ordinary game arguments untouched", () => {
    const { value, redacted } = redactArgs({ username: "Zezima", game: "osrs" });
    expect(value).toEqual({ username: "Zezima", game: "osrs" });
    expect(redacted).toBe(false);
  });

  it("masks values under secret-shaped keys", () => {
    const { value, redacted } = redactArgs({ api_key: "sk-abc123", item: "rune scimitar" });
    expect(value).toEqual({ api_key: "[REDACTED]", item: "rune scimitar" });
    expect(redacted).toBe(true);
  });

  it("masks email- and JWT-shaped values regardless of key", () => {
    const jwt = "eyJhbGciOiJub25lIn0.eyJ1c2VyIjoieCJ9.";
    const { value, redacted } = redactArgs({ contact: "a@b.com", tok: jwt });
    expect(value).toEqual({ contact: "[REDACTED]", tok: "[REDACTED]" });
    expect(redacted).toBe(true);
  });

  it("recurses into nested objects and arrays", () => {
    const { value, redacted } = redactArgs({ outer: { password: "hunter2", ok: "fine" }, list: ["a@b.com"] });
    expect(value).toEqual({ outer: { password: "[REDACTED]", ok: "fine" }, list: ["[REDACTED]"] });
    expect(redacted).toBe(true);
  });
});
