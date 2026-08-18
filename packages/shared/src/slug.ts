// Short, human URL handles for activity pages: /u/jessy instead of
// /u/2ce7c224cc0e4be8. Derived from the display name at registration and
// stable afterwards (renames don't move URLs); collisions get a numeric
// suffix (jessy, jessy2, …). Raw userIds keep resolving forever.

/**
 * Reduce a display name to a URL handle: any Unicode letters and digits
 * (so CJK names survive), runs joined by "-", lowercased, bounded. Returns
 * "" when nothing usable remains (emoji-only names) — callers fall back to
 * a userId prefix.
 */
export function slugifyName(name: string): string {
  const parts = name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return parts.join("-").slice(0, 30).replace(/-+$/, "");
}

/**
 * Handles that could shadow the other /u/ namespace: anything shaped like a
 * raw userId must never be assigned as a slug.
 */
export function isReservedSlug(slug: string): boolean {
  return /^[0-9a-f]{8,32}$/.test(slug);
}
