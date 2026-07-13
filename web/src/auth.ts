/**
 * Identity for the dashboard.
 *
 * A deliberate near-copy of @platform/ui/auth, and it is worth saying why rather than pretending it
 * is fine. The other two front ends are vanilla TypeScript and share the package by vendoring it;
 * this one is React, in a separate workspace with its own build, and pulling the design system in
 * here to get one module would drag a whole dependency chain behind it for no other benefit.
 *
 * The duplication is real and it will drift. What must NOT drift is the storage key — both read the
 * same `platform:identity`, so signing in on the home page signs you in here, and signing out on
 * either signs you out of both. The shape of that record is the contract; this file is one of two
 * implementations of it.
 */

const KEY = "platform:identity";
const AUTH = "/auth";

export interface Identity {
  mode: "guest" | "user";
  username?: string;
  code?: string;
  token?: string;
  expiresAt?: number;
  admin?: boolean;
}

function read(): Identity | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}

let identity: Identity | null = read();
const listeners = new Set<() => void>();

function write(id: Identity | null): void {
  identity = id;
  try {
    if (id) localStorage.setItem(KEY, JSON.stringify(id));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}

export const current = (): Identity | null => identity;
export const isSignedIn = (): boolean => identity?.mode === "user" && Boolean(identity.token);

/**
 * Admin, read from the SIGNED token.
 *
 * Used only to decide what to RENDER. Every write is checked again on the server against the same
 * claim — hiding a button is a courtesy, and the lock is on the door, not on the sign. Editing this
 * value in localStorage would reveal the controls and change nothing: the API would still say 403.
 */
export const isAdmin = (): boolean => identity?.mode === "user" && identity.admin === true;

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function claims(token: string): Record<string, unknown> {
  try {
    const seg = token.split(".")[1] ?? "";
    return JSON.parse(atob(seg.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function signIn(username: string, code: string): Promise<void> {
  const r = await fetch(`${AUTH}/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, code }),
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(typeof json.error === "string" ? json.error : `HTTP ${r.status}`);

  const token = String(json.token);
  write({
    mode: "user",
    username: String(json.username),
    code,
    token,
    expiresAt: Date.now() + Number(json.expiresIn ?? 0) * 1000,
    admin: claims(token).admin === true,
  });
}

export function signOut(): void {
  write(null);
}

/** A live token, re-minted from the stored code when the current one is near expiry. */
export async function token(): Promise<string | null> {
  if (!identity || identity.mode !== "user") return null;
  if (identity.token && (identity.expiresAt ?? 0) > Date.now() + 60_000) return identity.token;
  if (!identity.username || !identity.code) return null;
  try {
    await signIn(identity.username, identity.code);
    return identity.token ?? null;
  } catch {
    return null;
  }
}

/** The bearer header, or nothing. Reads are open, so a missing identity is not an error here. */
export async function authHeaders(): Promise<Record<string, string>> {
  const t = await token();
  return t ? { authorization: `Bearer ${t}` } : {};
}
