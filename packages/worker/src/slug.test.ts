import { describe, it, expect } from "vitest";
import { slugifyName, isReservedSlug } from "@ccclub/shared/slug";

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

  it("rejects anything under 3 characters", () => {
    expect(slugifyName("🔥🔥🔥")).toBe("");
    expect(slugifyName("Bo")).toBe("");
    expect(slugifyName("  ")).toBe("");
    expect(slugifyName("abc")).toBe("abc"); // exactly 3 is fine
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
