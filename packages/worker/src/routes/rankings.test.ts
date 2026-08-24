import { describe, expect, it } from "vitest";
import { agentSharePercent } from "./rankings.js";

describe("agentSharePercent", () => {
  it("preserves non-zero agent shares below one percent", () => {
    expect(agentSharePercent(54.0407, 75_452.4498)).toBe(0.07);
  });

  it("returns zero only when the numerator or denominator is zero", () => {
    expect(agentSharePercent(0, 100)).toBe(0);
    expect(agentSharePercent(10, 0)).toBe(0);
  });
});
