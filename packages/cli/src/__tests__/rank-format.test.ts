import { describe, it, expect } from "vitest";
import { formatLocalDateRange, getRankingNonCacheTokens, shouldShowGlobalJoinHint } from "../commands/rank.js";

// Build boundaries from LOCAL midnights so expectations hold in any test-runner
// timezone — mirroring how the server derives windows from the viewer's tz.
function localMidnightIso(y: number, m: number, d: number): string {
  return new Date(y, m - 1, d).toISOString();
}

describe("formatLocalDateRange", () => {
  it("collapses a single local day (Today/Yesterday) to one date", () => {
    const start = localMidnightIso(2026, 3, 5);
    const end = new Date(new Date(start).getTime() + 86_400_000).toISOString();
    expect(formatLocalDateRange(start, end, "daily")).toBe("2026-03-05");
  });

  it("renders multi-day windows with inclusive local end dates", () => {
    const start = localMidnightIso(2026, 3, 5);
    const end = new Date(new Date(start).getTime() + 7 * 86_400_000).toISOString();
    expect(formatLocalDateRange(start, end, "weekly")).toBe("2026-03-05 → 2026-03-11");
  });

  it("omits the meaningless all-time bounds", () => {
    expect(formatLocalDateRange("2020-01-01T00:00:00Z", "2099-12-31T00:00:00Z", "all-time")).toBe("");
  });
});

describe("getRankingNonCacheTokens", () => {
  const legacy = {
    inputTokens: 100,
    outputTokens: 50,
    reasoningTokens: 20,
  };

  it("uses the exact server total when available", () => {
    expect(getRankingNonCacheTokens({ ...legacy, nonCacheTokens: 150 })).toBe(150);
  });

  it("sums source-aware breakdowns from transitional responses", () => {
    expect(getRankingNonCacheTokens({
      ...legacy,
      agentBreakdown: [
        { source: "codex", costUSD: 1, totalTokens: 100, nonCacheTokens: 80, chatCount: 1, entryCount: 1, percent: 50 },
        { source: "claude", costUSD: 1, totalTokens: 100, nonCacheTokens: 70, chatCount: 1, entryCount: 1, percent: 50 },
      ],
    })).toBe(150);
  });

  it("keeps the legacy fallback for old responses without breakdowns", () => {
    expect(getRankingNonCacheTokens(legacy)).toBe(170);
  });
});

describe("shouldShowGlobalJoinHint", () => {
  const others = [{ userId: "someone" }, { userId: "else" }];

  it("nudges a private user the global board doesn't list", () => {
    expect(shouldShowGlobalJoinHint(others, "me", "private")).toBe(true);
  });

  it("stays quiet for a public user idle today, who is opted in but filtered out", () => {
    expect(shouldShowGlobalJoinHint(others, "me", "public")).toBe(false);
  });

  it("stays quiet for anyone already on the board", () => {
    expect(shouldShowGlobalJoinHint([...others, { userId: "me" }], "me", "private")).toBe(false);
  });

  it("stays quiet when the profile couldn't be read", () => {
    expect(shouldShowGlobalJoinHint(others, "me", undefined)).toBe(false);
  });
});
