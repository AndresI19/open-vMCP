/**
 * The tool-namespacing contract for the aggregate endpoint, in one place. The flattened catalog
 * qualifies every upstream tool as `${slug}${NS}${name}` (e.g. `rs-mcp__search_wiki`) because two
 * upstreams may both expose a `search`. `qualify` and `matchQualified` are exact inverses; keeping
 * both directions here means the prefix side and the reverse split can't drift apart.
 */

/** Separator between server slug and upstream tool name in the aggregate namespace: `rs-mcp__search_wiki`. */
export const NS = '__';

/** Qualify an upstream tool name under its server slug for the aggregate catalog. */
export function qualify(slug: string, name: string): string {
  return `${slug}${NS}${name}`;
}

/**
 * Reverse of `qualify`: map a qualified name back to one of `servers`. Matches against the known slug
 * list rather than splitting on NS, so an upstream tool whose own name contains "__" still resolves;
 * longest slug wins so one slug can't shadow another it prefixes.
 */
export function matchQualified<S extends { slug: string }>(
  servers: S[],
  qualified: string,
): { server: S; toolName: string } | null {
  const match = servers
    .filter((s) => qualified.startsWith(`${s.slug}${NS}`))
    .sort((a, b) => b.slug.length - a.slug.length)[0];
  if (!match) return null;
  return { server: match, toolName: qualified.slice(match.slug.length + NS.length) };
}
