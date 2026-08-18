import { describe, it, expect } from "vitest";
import { slugifyName, isReservedSlug } from "@ccclub/shared";

describe("slugifyName", () => {
  it("lowercases and joins word runs with hyphens", () => {
    expect(slugifyName("Matt Lane")).toBe("matt-lane");
    expect(slugifyName("jessy")).toBe("jessy");
    expect(slugifyName("RJM")).toBe("rjm");
  });

  it("keeps CJK names usable", () => {
    expect(slugifyName("新西楼token焚烧大队")).toBe("新西楼token焚烧大队");
    expect(slugifyName("清墨(salex)")).toBe("清墨-salex");
    expect(slugifyName("抗生素不能乱打")).toBe("抗生素不能乱打");
  });

  it("drops punctuation and emoji, returns empty when nothing remains", () => {
    expect(slugifyName("mazzy★star!")).toBe("mazzy-star");
    expect(slugifyName("🔥🔥🔥")).toBe("");
    expect(slugifyName("  ")).toBe("");
  });

  it("bounds the length without a trailing hyphen", () => {
    const slug = slugifyName("a".repeat(40) + " b");
    expect(slug.length).toBeLessThanOrEqual(30);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("isReservedSlug", () => {
  it("reserves anything shaped like a raw userId", () => {
    expect(isReservedSlug("2ce7c224cc0e4be8")).toBe(true);
    expect(isReservedSlug("deadbeef")).toBe(true);
    // Real names that merely contain hex letters are fine.
    expect(isReservedSlug("jessy")).toBe(false);
    expect(isReservedSlug("abcdef01xyz")).toBe(false);
    expect(isReservedSlug("dead")).toBe(false); // too short to be a userId
  });
});
