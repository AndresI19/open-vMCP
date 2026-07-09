// Mask secret/PII-shaped values in tool-call arguments before they hit Postgres.
// Honors the workspace "no secrets in logs" rule and mirrors gateway-style scanning.

const SECRET_KEY = /(pass|secret|token|api[-_]?key|authorization|auth|credential|bearer|cookie|session)/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const JWT = /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

const MASK = "[REDACTED]";

/**
 * Deep-copy `value`, replacing anything that looks like a secret/PII with a mask.
 * Returns the sanitized value and whether anything was masked.
 */
export function redactArgs(value: unknown): { value: unknown; redacted: boolean } {
  let redacted = false;

  const walk = (v: unknown, keyHint?: string): unknown => {
    if (typeof v === "string") {
      if ((keyHint && SECRET_KEY.test(keyHint)) || EMAIL.test(v) || JWT.test(v)) {
        redacted = true;
        return MASK;
      }
      return v;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (SECRET_KEY.test(k)) {
          out[k] = MASK;
          redacted = true;
        } else {
          out[k] = walk(val, k);
        }
      }
      return out;
    }
    return v;
  };

  return { value: walk(value), redacted };
}
