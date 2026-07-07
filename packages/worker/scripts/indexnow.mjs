#!/usr/bin/env node
/**
 * IndexNow ping — tells Bing/Yandex (and, via them, ChatGPT search) that
 * our pages changed. Runs automatically after `pnpm deploy`; safe to run
 * manually anytime:
 *
 *   node scripts/indexnow.mjs
 *
 * Reads the live sitemap, submits every URL in one batch. The key is
 * public by design — ownership is proven by serving <key>.txt from the
 * domain (see src/guide.ts).
 */

const SITE = "https://ccclub.dev";
const KEY = "c687c21aa0a1bfc46acf13854a646199";

const sitemapRes = await fetch(`${SITE}/sitemap.xml`);
if (!sitemapRes.ok) {
  console.error(`Failed to fetch sitemap: HTTP ${sitemapRes.status}`);
  process.exit(1);
}
const xml = await sitemapRes.text();
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (urls.length === 0) {
  console.error("No URLs found in sitemap.");
  process.exit(1);
}

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    host: "ccclub.dev",
    key: KEY,
    keyLocation: `${SITE}/${KEY}.txt`,
    urlList: urls,
  }),
});

// 200 = submitted, 202 = accepted (key validation pending)
console.log(`IndexNow: submitted ${urls.length} URLs → HTTP ${res.status}`);
if (res.status >= 400) {
  console.error(await res.text());
  process.exit(1);
}
