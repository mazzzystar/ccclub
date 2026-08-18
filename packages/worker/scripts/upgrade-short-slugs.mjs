// One-off: users who fell back to a userId-prefix slug because their name
// was under the old 3-char minimum get a proper handle under the relaxed
// rules (2+ chars bare, single char digit-expanded). Old prefix mappings
// are kept as aliases so shared links never break.
import { execFileSync } from "node:child_process";
import { slugifyName, isReservedSlug } from "@ccclub/shared/slug";

const NS = "04ff7a30114d42f9bd986d692d888f96";
function wr(args) {
  for (let a = 1; ; a++) {
    try {
      return execFileSync("npx", ["wrangler", "kv", "key", ...args, `--namespace-id=${NS}`],
        { encoding: "utf-8", timeout: 120_000 });
    } catch (e) { if (a >= 3) throw e; execFileSync("sleep", [String(a * 2)]); }
  }
}
function candidates(base) {
  if (base.length === 1) return Array.from({ length: 10 }, (_, i) => `${base}${i}`);
  return [base, ...Array.from({ length: 8 }, (_, i) => `${base}${i + 2}`)];
}

const taken = new Set(JSON.parse(wr(["list", "--prefix=slug:"])).map((k) => k.name.slice(5)));
const groupKeys = JSON.parse(wr(["list", "--prefix=group:"])).map((k) => k.name);
const groups = new Map(groupKeys.map((k) => [k, JSON.parse(wr(["get", k]))]));

const upgraded = new Map(); // userId -> new slug
for (const g of groups.values()) {
  for (const m of g.members ?? []) {
    if (upgraded.has(m.userId)) continue;
    const isFallback = m.slug === m.userId.slice(0, 8);
    if (!isFallback) continue;
    const base = slugifyName(m.displayName || "");
    if (!base) continue; // genuinely unusable name — fallback stays
    for (const c of candidates(base)) {
      if (isReservedSlug(c) || taken.has(c)) continue;
      taken.add(c);
      upgraded.set(m.userId, c);
      break;
    }
  }
}
console.log(`upgrading ${upgraded.size} users:`);
for (const [uid, slug] of upgraded) {
  console.log(`  ${uid.slice(0, 8)} -> ${slug}`);
  wr(["put", `slug:${slug}`, uid]); // old prefix mapping stays as an alias
}
let updated = 0;
for (const [key, g] of groups) {
  let changed = false;
  for (const m of g.members ?? []) {
    const want = upgraded.get(m.userId);
    if (want && m.slug !== want) { m.slug = want; changed = true; }
  }
  if (changed) { wr(["put", key, JSON.stringify(g)]); updated++; }
}
console.log(`groups updated: ${updated}`);
