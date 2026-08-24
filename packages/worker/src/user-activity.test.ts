import { describe, it, expect } from "vitest";
import { aggregateDays, localDayKey, activityOgSvg, cumulativeSeries, gridTicks } from "./activity-core.js";
import { computeActivityStats as computeStats } from "@ccclub/shared";
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

// These two ship to the browser as serialized source (see activity-core.ts),
// so this is the only place they get exercised.
describe("cumulativeSeries", () => {
  const day = (d: string, tokens: number) => ({ d, tokens });

  it("carries the running total across idle days", () => {
    const pts = cumulativeSeries([day("2026-08-01", 10), day("2026-08-04", 5)], "2026-08-05", 0);
    expect(pts.map((p) => `${p.d}:${p.v}`)).toEqual([
      "2026-08-01:10", "2026-08-02:10", "2026-08-03:10", "2026-08-04:15", "2026-08-05:15",
    ]);
  });

  it("never goes backwards, whatever order the days arrive in", () => {
    const pts = cumulativeSeries([day("2026-08-04", 5), day("2026-08-01", 10), day("2026-08-02", 1)], "2026-08-04", 0);
    expect(pts.map((p) => p.v)).toEqual([10, 11, 11, 16]);
  });

  it("skips a user with fewer than two active days", () => {
    expect(cumulativeSeries([day("2026-08-01", 10)], "2026-08-05", 0)).toEqual([]);
    expect(cumulativeSeries([day("2026-08-01", 0), day("2026-08-02", 0)], "2026-08-05", 0)).toEqual([]);
    expect(cumulativeSeries([], "2026-08-05", 0)).toEqual([]);
  });

  it("ends on the all-time total when seeded with the days it wasn't given", () => {
    // What the page does: the API sends a window, the stats cover all time.
    const windowed = [day("2026-08-01", 10), day("2026-08-02", 5)];
    const allTime = 400;
    const carry = allTime - windowed.reduce((sum, d) => sum + d.tokens, 0);
    const pts = cumulativeSeries(windowed, "2026-08-02", carry);
    expect(pts[pts.length - 1].v).toBe(allTime);
    expect(pts[0].v).toBe(395);
  });

  it("ignores a negative seed and malformed days", () => {
    const junk = [null, { tokens: 5 }, { d: 7, tokens: 5 }, day("2026-08-01", 10), day("2026-08-02", 5)];
    const pts = cumulativeSeries(junk as Array<{ d: string; tokens: number }>, "2026-08-02", -7);
    expect(pts.map((p) => p.v)).toEqual([10, 15]);
  });

  it("adds string token counts instead of concatenating them", () => {
    const wire = [{ d: "2026-08-01", tokens: "5" }, { d: "2026-08-03", tokens: "7" }];
    const pts = cumulativeSeries(wire as unknown as Array<{ d: string; tokens: number }>, "2026-08-03", 0);
    expect(pts.map((p) => p.v)).toEqual([5, 5, 12]);
  });

  it("drops the oldest days, not the newest, when the span outruns the cap", () => {
    const start = Date.parse("2024-01-01T00:00:00Z");
    // Only the last 800 days are drawn; days 0 and 100 fall outside it.
    const days = [0, 100, 900, 1000].map((n) => day(new Date(start + n * 86_400_000).toISOString().slice(0, 10), 10));
    const today = days[days.length - 1].d;
    const pts = cumulativeSeries(days, today, 0);
    expect(pts.length).toBe(800);
    expect(pts[pts.length - 1].d).toBe(today);
    // Everything that fell off the front is still in the total.
    expect(pts[pts.length - 1].v).toBe(40);
    expect(pts[0].v).toBe(20);
  });

  it("returns nothing for dates it can't make sense of", () => {
    expect(cumulativeSeries([day("2026-08-01", 1), day("2026-08-02", 1)], "nonsense", 0)).toEqual([]);
    expect(cumulativeSeries([day("2026-08-08", 1), day("2026-08-09", 1)], "2026-08-01", 0)).toEqual([]);
  });

  it("steps one calendar day at a time across a DST boundary", () => {
    // US DST ends 2026-11-01; the series is UTC-keyed and shouldn't stutter.
    const pts = cumulativeSeries([day("2026-10-30", 1), day("2026-11-03", 1)], "2026-11-03", 0);
    expect(pts.map((p) => p.d)).toEqual([
      "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03",
    ]);
  });
});

describe("gridTicks", () => {
  it("keeps 2 to 4 gridlines across every realistic total", () => {
    for (let exp = 3; exp <= 13; exp++) {
      for (const mantissa of [1, 1.3, 2, 2.5, 3, 4, 4.2, 5, 6.7, 8, 9.9]) {
        const total = Math.round(mantissa * 10 ** exp);
        const top = total * 1.08; // the headroom the chart draws with
        const ticks = gridTicks(top);
        expect(ticks.length, `total ${total}`).toBeGreaterThanOrEqual(2);
        expect(ticks.length, `total ${total}`).toBeLessThanOrEqual(4);
        expect(ticks[0]).toBe(0);
        expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(top);
        // The top gridline has to be a useful reference, not a floor-hugger.
        expect(ticks[ticks.length - 1]).toBeGreaterThan(top / 2);
      }
    }
  });

  it("spaces ticks evenly on a 1, 2 or 5 step", () => {
    expect(gridTicks(1.24e9 * 1.08)).toEqual([0, 5e8, 1e9]);
    expect(gridTicks(4.2e9 * 1.08)).toEqual([0, 2e9, 4e9]);
    expect(gridTicks(300 * 1.08)).toEqual([0, 100, 200, 300]);
  });

  it("gives up rather than loop on a degenerate range", () => {
    expect(gridTicks(0)).toEqual([]);
    expect(gridTicks(-5)).toEqual([]);
  });
});

describe("activityOgSvg", () => {
  const base = {
    name: "jessy",
    avatarDataUri: null,
    avatarColor: "#4a8aaa",
    todayKey: "2026-08-18",
  };
  const stats = computeStats(new Map([["2026-08-18", { d: "2026-08-18", tokens: 5_000_000_000, cost: 0, chats: 0 }]]), "2026-08-18");

  it("renders the name, stats, and a full year of cells", () => {
    const svg = activityOgSvg({ ...base, stats, tokensByDay: new Map([["2026-08-18", 5_000_000_000]]) });
    expect(svg).toContain("jessy");
    expect(svg).toContain("5.0B");
    // 53 weeks × 7 days minus 4 future days (2026-08-18 is a Tuesday).
    expect((svg.match(/<rect x=/g) ?? []).length).toBe(371 - 4);
    // A 5B day hits the brightest purple.
    expect(svg).toContain("#a97fff");
  });

  it("falls back to an initial circle without an avatar", () => {
    const svg = activityOgSvg({ ...base, stats, tokensByDay: new Map() });
    expect(svg).toContain('fill="#4a8aaa"');
    expect(svg).toContain(">J</text>");
    expect(svg).not.toContain("<image");
  });
});
