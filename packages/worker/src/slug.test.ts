import { describe, it, expect } from "vitest";
import { slugifyName, isReservedSlug } from "@ccclub/shared/slug";
import { slugCandidates } from "./routes/auth.js";

describe("slugifyName", () => {
  it("lowercases and joins word runs with hyphens", () => {
    expect(slugifyName("Matt Lane")).toBe("matt-lane");
    expect(slugifyName("jessy")).toBe("jessy");
    expect(slugifyName("RJM")).toBe("rjm");
  });

  it("converts Chinese to pinyin, one word per han run", () => {
    expect(slugifyName("清墨(salex)")).toBe("qingmo-salex");
    expect(slugifyName("新西楼token焚烧大队")).toBe("xinxilou-token-fenshaodadui");
    expect(slugifyName("抗生素不能乱打")).toBe("kangshengsubunengluanda");
  });

  it("folds accents to ASCII", () => {
    expect(slugifyName("Café Müller")).toBe("cafe-muller");
  });

  it("drops punctuation and emoji", () => {
    expect(slugifyName("mazzy★star!")).toBe("mazzy-star");
    expect(slugifyName("anjing2829@sina.com")).toBe("anjing2829-sina-com");
  });

  it("keeps short names and rejects only the unusable", () => {
    expect(slugifyName("dk")).toBe("dk"); // two letters make a fine handle
    expect(slugifyName("Bo")).toBe("bo");
    expect(slugifyName("d")).toBe("d"); // single char — assignment digit-expands
    expect(slugifyName("🔥🔥🔥")).toBe("");
    expect(slugifyName("  ")).toBe("");
  });

  it("digit-expands single-character bases, numbers longer ones", () => {
    expect(slugCandidates("d")).toEqual(["d0","d1","d2","d3","d4","d5","d6","d7","d8","d9"]);
    expect(slugCandidates("dk")).toEqual(["dk","dk2","dk3","dk4","dk5","dk6","dk7","dk8","dk9"]);
  });

  it("bounds the length without a trailing hyphen", () => {
    const slug = slugifyName("a".repeat(40) + " b");
    expect(slug.length).toBeLessThanOrEqual(30);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("isReservedSlug", () => {
  it("reserves exactly the real-userId shape (16 hex)", () => {
    expect(isReservedSlug("2ce7c224cc0e4be8")).toBe(true);
    // Shorter hex runs can't be full userIds — usable as slugs, including
    // the userId-prefix fallback.
    expect(isReservedSlug("2ce7c224")).toBe(false);
    expect(isReservedSlug("deadbeef")).toBe(false);
    expect(isReservedSlug("jessy")).toBe(false);
  });
});
