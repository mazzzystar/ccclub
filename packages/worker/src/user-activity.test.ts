import { describe, it, expect } from "vitest";
import { aggregateDays, computeStats, localDayKey } from "./user-activity.js";
import type { UsageBlock } from "@ccclub/shared";

function block(blockStart: string, totalTokens: number, extra: Partial<UsageBlock> = {}): UsageBlock {
  return {
    blockStart,
    blockEnd: blockStart,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens,
    costUSD: extra.costUSD ?? 1,
    models: [],
    entryCount: 1,
    ...extra,
  };
}

describe("localDayKey / aggregateDays", () => {
  it("assigns a block to the viewer-local day, not the UTC day", () => {
    // 2026-08-17 23:30 UTC is already Aug 18 in UTC+8 (tz=480).
    const ms = Date.parse("2026-08-17T23:30:00Z");
    expect(localDayKey(ms, 0)).toBe("2026-08-17");
    expect(localDayKey(ms, 480)).toBe("2026-08-18");
    expect(localDayKey(ms, -480)).toBe("2026-08-17");
  });

  it("sums tokens, cost, and chats per day and skips non-ranked sources", () => {
    const days = aggregateDays([
      block("2026-08-17T01:00:00Z", 100, { chatCount: 2 }),
      block("2026-08-17T09:00:00Z", 50, { chatCount: 1 }),
      block("2026-08-18T01:00:00Z", 7),
      block("2026-08-18T02:00:00Z", 999, { source: "openclaw" as UsageBlock["source"] }),
    ], 0);

    expect(days.get("2026-08-17")).toMatchObject({ tokens: 150, chats: 3 });
    expect(days.get("2026-08-18")).toMatchObject({ tokens: 7 });
    expect(days.size).toBe(2);
  });
});

describe("computeStats", () => {
  const mk = (entries: Array<[string, number]>) =>
    new Map(entries.map(([d, tokens]) => [d, { d, tokens, cost: 0, chats: 0 }]));

  it("computes totals, peak day, and active days", () => {
    const s = computeStats(mk([["2026-08-01", 10], ["2026-08-02", 30], ["2026-08-05", 20]]), "2026-08-18");
    expect(s.totalTokens).toBe(60);
    expect(s.peakDay).toBe("2026-08-02");
    expect(s.peakDayTokens).toBe(30);
    expect(s.activeDays).toBe(3);
  });

  it("finds the longest streak across gaps", () => {
    const s = computeStats(mk([
      ["2026-08-01", 1], ["2026-08-02", 1], ["2026-08-03", 1], // 3
      ["2026-08-10", 1], ["2026-08-11", 1],                     // 2
    ]), "2026-08-18");
    expect(s.longestStreak).toBe(3);
    expect(s.currentStreak).toBe(0); // last activity a week ago
  });

  it("counts the current streak when it ends today", () => {
    const s = computeStats(mk([["2026-08-16", 1], ["2026-08-17", 1], ["2026-08-18", 1]]), "2026-08-18");
    expect(s.currentStreak).toBe(3);
    expect(s.longestStreak).toBe(3);
  });

  it("keeps the streak alive when today has no activity yet", () => {
    const s = computeStats(mk([["2026-08-16", 1], ["2026-08-17", 1]]), "2026-08-18");
    expect(s.currentStreak).toBe(2);
  });

  it("handles the empty and single-day cases", () => {
    expect(computeStats(mk([]), "2026-08-18").currentStreak).toBe(0);
    expect(computeStats(mk([]), "2026-08-18").peakDay).toBeNull();
    const one = computeStats(mk([["2026-08-18", 5]]), "2026-08-18");
    expect(one.currentStreak).toBe(1);
    expect(one.longestStreak).toBe(1);
  });
});
