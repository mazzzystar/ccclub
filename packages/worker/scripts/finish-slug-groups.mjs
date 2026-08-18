// Finish the interrupted backfill: slug mappings are all written; this
// copies each user's stored slug onto their group member records (what the
// dashboard links read). Idempotent — groups already carrying the right
// slug are skipped. Parallel with retries, so it finishes in minutes.
//
// Usage: node scripts/finish-slug-groups.mjs
import { execFile } from "node:child_process";

const NS = "04ff7a30114d42f9bd986d692d888f96";
const CONCURRENCY = 10;

function wr(args) {
  return new Promise((resolve, reject) => {
    const run = (attempt) => {
      execFile("npx", ["wrangler", "kv", "key", ...args, `--namespace-id=${NS}`],
        { encoding: "utf-8", timeout: 120_000 },
        (err, stdout) => {
          if (!err) return resolve(stdout);
          if (attempt >= 3) return reject(err);
          setTimeout(() => run(attempt + 1), attempt * 2000);
        });
    };
    run(1);
  });
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }));
  return results;
}

// userId -> slug, inverted from the stored mappings (the source of truth —
// they include server-assigned slugs for users who registered mid-migration).
const slugKeys = JSON.parse(await wr(["list", "--prefix=slug:"])).map((k) => k.name);
console.log(`slug mappings: ${slugKeys.length}`);
const pairs = await mapLimit(slugKeys, CONCURRENCY, async (key) => [key.slice(5), (await wr(["get", key])).trim()]);
const slugOf = new Map(pairs.map(([slug, userId]) => [userId, slug]));

const groupKeys = JSON.parse(await wr(["list", "--prefix=group:"])).map((k) => k.name);
const updated = await mapLimit(groupKeys, CONCURRENCY, async (key) => {
  const g = JSON.parse(await wr(["get", key]));
  let changed = false;
  for (const m of g.members ?? []) {
    const want = slugOf.get(m.userId);
    if (want && m.slug !== want) { m.slug = want; changed = true; }
  }
  if (!changed) return 0;
  await wr(["put", key, JSON.stringify(g)]);
  return 1;
});
console.log(`groups updated: ${updated.reduce((a, b) => a + b, 0)}/${groupKeys.length}`);
