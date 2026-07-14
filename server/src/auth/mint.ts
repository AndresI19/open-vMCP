import { loadAuthConfig } from '../config/load.js';

/** Set a value at a dot-path, creating intermediate objects as needed. */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  // Never let a path segment reach into the prototype chain. The path is developer-supplied config
  // today, not user input, but this two-line guard closes the prototype-pollution class outright and
  // costs nothing.
  if (keys.some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype')) return;
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

/**
 * Mint an UNSIGNED, JWT-shaped mock token that carries `userId` wherever the auth
 * config expects it. Purely for exercising the front end — there is no signature.
 */
export function mintMockToken(userId: string): string {
  const cfg = loadAuthConfig();
  const payload: Record<string, unknown> = {};
  for (const m of cfg.claimMappings) {
    if (m.to === 'userId') setByPath(payload, m.from, userId);
  }
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`;
}
