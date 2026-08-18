import TinyPinyin from "tiny-pinyin";

// Short, human URL handles for activity pages: /u/jessy, /u/qingmo-salex —
// never /u/2ce7c224cc0e4be8 unless the name yields nothing usable.
//
// The rules, in order:
//   1. Chinese converts to pinyin ("清墨" → "qingmo"); each han run is one
//      word, so mixed names read naturally ("新西楼token焚烧大队" →
//      "xinxilou-token-fenshaodadui").
//   2. Everything else is ASCII-folded (é → e) and stripped to [a-z0-9]
//      runs joined by "-", capped at 30 chars.
//   3. Under 3 chars the name isn't a usable handle — callers fall back to
//      a userId prefix.
// Assignment (server-side) tries the bare slug then jessy2…jessy9 — a
// constant number of KV probes, never an unbounded scan.

const HAN = /\p{Script=Han}/u;

/** ASCII slug from a display name; "" when under 3 usable characters. */
export function slugifyName(name: string): string {
  // Han runs become single pinyin words; everything else passes through.
  let ascii = "";
  let hanRun = "";
  for (const ch of name) {
    if (HAN.test(ch)) {
      hanRun += TinyPinyin.isSupported() ? TinyPinyin.convertToPinyin(ch) : "";
    } else {
      if (hanRun) { ascii += ` ${hanRun} `; hanRun = ""; }
      ascii += ch;
    }
  }
  if (hanRun) ascii += ` ${hanRun}`;

  const folded = ascii.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const slug = (folded.match(/[a-z0-9]+/g) ?? []).join("-").slice(0, 30).replace(/-+$/, "");
  return slug.length >= 3 ? slug : "";
}

/**
 * Handles shaped exactly like a real userId (16 hex chars) are reserved so a
 * display name can never shadow another user's raw-id URL. Shorter hex runs
 * ("dead", "beef8888") are fine — they can't be full userIds.
 */
export function isReservedSlug(slug: string): boolean {
  return /^[0-9a-f]{16}$/.test(slug);
}
