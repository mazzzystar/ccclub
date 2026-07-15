import { describe, expect, it } from "vitest";
import { getNonCacheTokens } from "@ccclub/shared";

describe("getNonCacheTokens", () => {
  const usage = {
    inputTokens: 100,
    outputTokens: 50,
    reasoningTokens: 20,
  };

  it("does not add the Codex reasoning breakdown twice", () => {
    expect(getNonCacheTokens({ ...usage, source: "codex" })).toBe(150);
  });

  it("keeps separately reported reasoning for other sources", () => {
    expect(getNonCacheTokens({ ...usage, source: "opencode" })).toBe(170);
    expect(getNonCacheTokens({ ...usage, source: undefined })).toBe(170);
  });
});
