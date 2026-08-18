// One-off backfill: assign URL slugs to every existing user, using the SAME
// slugify implementation the server runs (@ccclub/shared/slug — pinyin for
// CJK, ASCII-folded otherwise, min 3 chars). Earliest group-joiner wins the
// bare name; collisions get name2…name9; unusable names fall back to a
// userId prefix. Deletes any slug mappings from earlier algorithms first.
//
// Usage: node scripts/migrate-slugs.mjs
import { execFileSync } from "node:child_process";
import { slugifyName, isReservedSlug } from "@ccclub/shared/slug";

const NS = "04ff7a30114d42f9bd986d692d888f96";

function wr(...args) {
  return execFileSync("npx", ["wrangler", "kv", "key", ...args, `--namespace-id=${NS}`],
    { encoding: "utf-8", timeout: 120_000 });
}
function list(prefix) {
  return JSON.parse(wr("list", `--prefix=${prefix}`)).map((k) => k.name);
}

// 1. Wipe mappings from any earlier run — single source of truth is this algorithm.
const oldKeys = list("slug:");
console.log(`deleting ${oldKeys.length} existing slug mappings`);
for (const key of oldKeys) wr("delete", key);

// 2. Load all groups.
const groupKeys = list("group:");
const groups = new Map();
for (const key of groupKeys) groups.set(key, JSON.parse(wr("get", key)));
console.log(`groups: ${groups.size}`);

// 3. Unique users, ordered by earliest joinedAt (a fair proxy for signup order).
const users = new Map(); // userId -> { name, firstJoined }
for (const g of groups.values()) {
  for (const m of g.members ?? []) {
    const seen = users.get(m.userId);
    const joined = m.joinedAt ?? "9999";
    if (!seen || joined < seen.firstJoined) {
      users.set(m.userId, { name: m.displayName || m.userId.slice(0, 8), firstJoined: joined });
    }
  }
}
console.log(`users: ${users.size}`);

// 4. Assign locally (namespace is empty now), then write.
const taken = new Set();
const slugOf = new Map();
const order = [...users.entries()].sort((a, b) =>
  a[1].firstJoined < b[1].firstJoined ? -1 : a[1].firstJoined > b[1].firstJoined ? 1 : a[0] < b[0] ? -1 : 1);
for (const [userId, info] of order) {
  const named = slugifyName(info.name);
  const bases = named ? [named, userId.slice(0, 8)] : [userId.slice(0, 8)];
  let chosen;
  outer: for (const base of bases) {
    for (let n = 1; n <= 9; n++) {
      const candidate = n === 1 ? base : `${base}${n}`;
      if (isReservedSlug(candidate) || taken.has(candidate)) continue;
      chosen = candidate;
      break outer;
    }
  }
  if (!chosen) continue;
  taken.add(chosen);
  slugOf.set(userId, chosen);
}
console.log(`assigning ${slugOf.size} slugs`);
for (const [userId, slug] of slugOf) wr("put", `slug:${slug}`, userId);

// 5. Rewrite groups with member.slug.
let updated = 0;
for (const [key, g] of groups) {
  let changed = false;
  for (const m of g.members ?? []) {
    const want = slugOf.get(m.userId);
    if (want && m.slug !== want) { m.slug = want; changed = true; }
  }
  if (changed) { wr("put", key, JSON.stringify(g)); updated++; }
}
console.log(`groups updated: ${updated}/${groups.size}`);

const sample = [...slugOf.entries()].slice(0, 6).map(([u, s]) => `${users.get(u).name} -> ${s}`);
console.log("sample:", sample.join(" | "));
