import type { MiddlewareHandler } from "hono";
import type { Env } from "./types.js";

/**
 * Edge caching for HTML that is a compile-time constant.
 *
 * The guide and blog pages are rendered from module-level data: the same
 * request produces byte-identical output until the Worker is redeployed, so
 * there is no reason to re-render them per request in every colo. They are
 * put in the Workers Cache API keyed by request URL, with a one-hour shared
 * TTL and a browser TTL of zero — a deploy should be visible immediately to
 * anyone who reloads, and the edge copy is replaced on the next miss.
 *
 * What is deliberately NOT cached here:
 *
 * - `/api/*`, `/g/*`, `/u/*` — per-user or live data. The group board keeps
 *   its own SSR cache inside dashboard.ts; nothing here touches it.
 * - The landing pages, English and localized alike. Two independent reasons:
 *   they embed the demo group's live board, which is read from KV on every
 *   render, and they carry a `Set-Cookie` for the language memory. A response
 *   with a cookie in it is exactly the kind a shared cache must not replay,
 *   and stripping the cookie to make it cacheable would quietly drop the
 *   behaviour it exists for. The `/` route's Accept-Language redirect
 *   therefore also keeps running ahead of anything cache-related, because no
 *   cache lookup happens on that path at all.
 */
export const STATIC_HTML_S_MAXAGE = 3600;

/** Our own hit/miss marker: cf-cache-status is absent in `wrangler dev`. */
export const CACHE_STATUS_HEADER = "x-ccclub-cache";

function edgeCache(): Cache | null {
  // Absent under vitest/node, and absent in any runtime without the Cache API.
  const store = (globalThis as { caches?: CacheStorage }).caches;
  return store?.default ?? null;
}

/**
 * Serve a handler's HTML from the edge cache, storing it on a miss.
 * Only a 200 is ever stored; anything else (404s, redirects) falls through
 * untouched so an error can never be pinned to a URL for an hour.
 */
export function cacheStaticHTML(
  sMaxAge = STATIC_HTML_S_MAXAGE,
): MiddlewareHandler<{ Bindings: Env }> {
  const cacheControl = `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${sMaxAge}`;

  return async (c, next) => {
    // The Cache API may be absent (vitest, any non-Workers runtime). The
    // header still goes out either way — it is what Cloudflare's own cache
    // and every intermediary read, independently of this lookup.
    const cache = c.req.method === "GET" ? edgeCache() : null;
    const key = cache == null ? null : new Request(c.req.url, { method: "GET" });

    if (cache != null && key != null) {
      const hit = await cache.match(key);
      if (hit != null) {
        const res = new Response(hit.body, hit);
        res.headers.set(CACHE_STATUS_HEADER, "hit");
        c.res = res;
        return;
      }
    }

    await next();
    const built = c.res;
    if (built.status !== 200) return;

    // Buffer rather than tee. These pages are a few tens of kilobytes, and one
    // body stream cannot be handed to both the client and cache.put() without
    // the two racing for it — the symptom is a 500 on the very first request,
    // after the entry has already been stored.
    const body = await built.arrayBuffer();
    const headers = new Headers(built.headers);
    headers.set("Cache-Control", cacheControl);
    if (cache != null) headers.set(CACHE_STATUS_HEADER, "miss");
    c.res = new Response(body, { status: 200, headers });

    if (cache == null || key == null) return;

    let waitUntil: ((p: Promise<unknown>) => void) | undefined;
    try {
      waitUntil = c.executionCtx?.waitUntil?.bind(c.executionCtx);
    } catch {
      waitUntil = undefined; // no execution context (direct fetch in tests)
    }
    // The stored copy carries no hit/miss marker: it gets "hit" on the way out.
    const storedHeaders = new Headers(headers);
    storedHeaders.delete(CACHE_STATUS_HEADER);
    const put = cache
      .put(key, new Response(body, { status: 200, headers: storedHeaders }))
      .catch(() => {
        // An uncacheable response or a full cache is not worth failing over.
      });
    if (waitUntil) waitUntil(put);
    else await put;
  };
}
