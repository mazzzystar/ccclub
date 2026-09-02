import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  activityCommand,
  buildDayTotals,
  heatmapLines,
  formatTokensShort,
  type HeatmapPaint,
} from "../commands/activity.js";
import { computeActivityStats, activityLevelFor, ACTIVITY_LEVEL_THRESHOLDS } from "@ccclub/shared";
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
    costUSD: 1,
    models: [],
    entryCount: 1,
    ...extra,
  };
}

// Tests key by UTC so they don't depend on the machine timezone; the command
// itself keys by machine-local day via the default keyOf.
const utcKey = (d: Date) => d.toISOString().slice(0, 10);

describe("buildDayTotals", () => {
  it("groups blocks into days and skips non-ranked sources", () => {
    const days = buildDayTotals([
      block("2026-08-17T01:00:00Z", 100, { chatCount: 2 }),
      block("2026-08-17T20:00:00Z", 40, { chatCount: 1 }),
      block("2026-08-18T05:00:00Z", 7),
      block("2026-08-18T06:00:00Z", 500, { source: "openclaw" as UsageBlock["source"] }),
      block("not-a-date", 999),
    ], utcKey);

    expect(days.get("2026-08-17")).toMatchObject({ tokens: 140, chats: 3, cost: 2 });
    expect(days.get("2026-08-18")).toMatchObject({ tokens: 7 });
    expect(days.size).toBe(2);
  });
});

describe("absolute activity levels", () => {
  it("maps daily tokens onto the shared calibrated scale", () => {
    expect(activityLevelFor(0)).toBe(0);
    expect(activityLevelFor(1)).toBe(1);              // any activity shows
    expect(activityLevelFor(38_000_000)).toBe(3);     // the median active day: mid-green
    expect(activityLevelFor(99_000_000)).toBe(4);     // top of green
    expect(activityLevelFor(100_000_000)).toBe(5);    // first gold
    expect(activityLevelFor(450_000_000)).toBe(7);    // p90 day: solid gold
    expect(activityLevelFor(999_999_999)).toBe(8);    // top of gold
    expect(activityLevelFor(1_000_000_000)).toBe(9);  // first purple
    expect(activityLevelFor(25_000_000_000)).toBe(12);// whale peak: max purple
  });

  it("is absolute: the same day renders the same level for every user", () => {
    // The old per-user quartile scale rendered a 1M/day user and a 1B/day
    // user identically — the exact information a leaderboard cares about.
    expect(activityLevelFor(1_000_000)).toBeLessThan(activityLevelFor(1_000_000_000));
  });

  it("is monotonic across every threshold boundary", () => {
    let prev = 0;
    for (const min of ACTIVITY_LEVEL_THRESHOLDS) {
      for (const v of [min - 1, min, min + 1]) {
        const lvl = activityLevelFor(Math.max(0, v));
        expect(lvl).toBeGreaterThanOrEqual(prev);
        prev = lvl;
      }
    }
    expect(prev).toBe(12);
  });
});

describe("heatmapLines", () => {
  const TODAY = "2026-08-18"; // a Tuesday

  function recordCells() {
    const painted: number[] = [];
    let futures = 0;
    const paint: HeatmapPaint = {
      cell: (level) => { painted.push(level); return String(level); },
      future: () => { futures++; return " "; },
      label: (text) => text,
    };
    return { painted, paint, futures: () => futures };
  }

  it("renders 1 header + 7 rows + legend, all rows equally wide", () => {
    const lines = heatmapLines(new Map(), TODAY);
    expect(lines).toHaveLength(9);
    const rowWidths = lines.slice(1, 8).map((l) => l.length);
    expect(new Set(rowWidths).size).toBe(1);
    expect(rowWidths[0]).toBe(4 + 53);
  });

  it("covers exactly 366 past days plus today, no future cells painted", () => {
    const { painted, paint, futures } = recordCells();
    heatmapLines(new Map(), TODAY, paint);
    // 53 weeks × 7 days = 371 cells; today is a Tuesday so 4 cells of the
    // final week are future (Wed..Sat) — minus the 12 legend swatches.
    expect(futures()).toBe(4);
    expect(painted.length - 12).toBe(371 - 4);
  });

  it("puts today's tokens in the last painted cell of its weekday row", () => {
    const { paint } = recordCells();
    const lines = heatmapLines(new Map([[TODAY, 100_000_000]]), TODAY, paint);
    const tuesdayRow = lines[3]; // header, Sun, Mon, Tue
    const lastPainted = tuesdayRow.trimEnd().slice(-1);
    expect(lastPainted).not.toBe("0"); // active today → non-zero level
  });

  it("orders month labels chronologically ending at the current month", () => {
    const lines = heatmapLines(new Map(), TODAY);
    const labels = lines[0].trim().split(/\s+/);
    // The first column starts mid-August a year ago, so the first *full*
    // month labeled is September; twelve labels end at the current month.
    expect(labels).toEqual(["Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"]);
  });
});

describe("stats over CLI day totals", () => {
  it("streaks agree with the shared implementation", () => {
    const days = buildDayTotals([
      block("2026-08-16T10:00:00Z", 10),
      block("2026-08-17T10:00:00Z", 10),
      block("2026-08-18T10:00:00Z", 10),
    ], utcKey);
    const stats = computeActivityStats(days, "2026-08-18");
    expect(stats.currentStreak).toBe(3);
    expect(stats.longestStreak).toBe(3);
    expect(stats.totalTokens).toBe(30);
  });
});

describe("formatTokensShort", () => {
  it("scales units", () => {
    expect(formatTokensShort(444_400_000_000)).toBe("444.4B");
    expect(formatTokensShort(2_060_000_000)).toBe("2.1B");
    expect(formatTokensShort(1_500_000)).toBe("1.5M");
    expect(formatTokensShort(950)).toBe("950");
  });
});

describe("activityCommand", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("skips the scan while a sync holds the lock", async () => {
    const home = await mkdtemp(join(tmpdir(), "ccclub-activity-"));
    tempDirs.push(home);
    await mkdir(join(home, ".ccclub"), { recursive: true });
    await writeFile(join(home, ".ccclub", "sync.lock"), "999999:held-by-a-sync");
    vi.stubEnv("HOME", home);

    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    await activityCommand({ json: true });

    // --json owns stdout: the skip notice must not land in the JSON stream.
    expect(out).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(expect.stringContaining("already scanning"));
  });
});
