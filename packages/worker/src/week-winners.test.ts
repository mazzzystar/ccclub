import { describe, it, expect } from "vitest";
import { currentWeekDays, resolveWeekWinners, tallyDay, weekWindowUtc } from "./week-winners.js";
import type { WeekTally } from "./week-winners.js";

const UTC8 = 480;

function tally(rows: Array<[string, string, string, number?]>): WeekTally {
  const map: WeekTally = new Map();
  for (const [day, source, userId, tokens] of rows) {
    tallyDay(map, day, source as never, userId, tokens ?? 0);
  }
  return map;
}

describe("currentWeekDays", () => {
  it("runs Monday through today and grows one slot per day", () => {
    // 2026-08-19 is a Wednesday.
    const wed = Date.parse("2026-08-19T10:00:00Z");
    expect(currentWeekDays(wed, 0)).toEqual(["2026-08-17", "2026-08-18", "2026-08-19"]);

    const mon = Date.parse("2026-08-17T00:30:00Z");
    expect(currentWeekDays(mon, 0)).toEqual(["2026-08-17"]);
  });

  it("treats Sunday as the last day of the week, not the first", () => {
    const sun = Date.parse("2026-08-23T12:00:00Z");
    expect(currentWeekDays(sun, 0)).toHaveLength(7);
    expect(currentWeekDays(sun, 0)[6]).toBe("2026-08-23");
  });

  it("uses the viewer's local calendar, not UTC", () => {
    // 16:00 UTC Sunday is already Monday 00:00 in UTC+8 — a fresh week there.
    const ms = Date.parse("2026-08-23T16:00:00Z");
    expect(currentWeekDays(ms, 0)).toHaveLength(7);
    expect(currentWeekDays(ms, UTC8)).toEqual(["2026-08-24"]);
  });
});

describe("weekWindowUtc", () => {
  it("spans exactly seven local days starting Monday midnight", () => {
    const wed = Date.parse("2026-08-19T10:00:00Z");
    const { startMs, endMs } = weekWindowUtc(wed, 0);
    expect(new Date(startMs).toISOString()).toBe("2026-08-17T00:00:00.000Z");
    expect(endMs - startMs).toBe(7 * 86_400_000);
  });

  it("shifts the boundary by the viewer's offset", () => {
    const wed = Date.parse("2026-08-19T10:00:00Z");
    const { startMs } = weekWindowUtc(wed, UTC8);
    // Monday 00:00 in UTC+8 is Sunday 16:00 UTC.
    expect(new Date(startMs).toISOString()).toBe("2026-08-16T16:00:00.000Z");
  });

  it("covers every day currentWeekDays reports", () => {
    const sun = Date.parse("2026-08-23T23:00:00Z");
    const { startMs, endMs } = weekWindowUtc(sun, 0);
    for (const day of currentWeekDays(sun, 0)) {
      const noon = Date.parse(`${day}T12:00:00Z`);
      expect(noon).toBeGreaterThanOrEqual(startMs);
      expect(noon).toBeLessThan(endMs);
    }
  });
});

describe("resolveWeekWinners", () => {
  it("picks the source the most distinct members used", () => {
    const map = tally([
      ["2026-08-17", "claude", "u1"],
      ["2026-08-17", "claude", "u2"],
      ["2026-08-17", "codex", "u3"],
    ]);
    const [day] = resolveWeekWinners(map, ["2026-08-17"]);
    expect(day.winners).toEqual(["claude"]);
    expect(day.counts).toEqual([
      { source: "claude", users: 2 },
      { source: "codex", users: 1 },
    ]);
  });

  it("counts each member once no matter how many blocks they synced", () => {
    const map = tally([
      ["2026-08-17", "claude", "u1"],
      ["2026-08-17", "claude", "u1"],
      ["2026-08-17", "claude", "u1"],
      ["2026-08-17", "codex", "u2"],
      ["2026-08-17", "codex", "u3"],
    ]);
    expect(resolveWeekWinners(map, ["2026-08-17"])[0].winners).toEqual(["codex"]);
  });

  it("does not let one heavy user outvote a larger head count", () => {
    const map = tally([
      ["2026-08-17", "codex", "whale", 999_999_999],
      ["2026-08-17", "claude", "u1", 10],
      ["2026-08-17", "claude", "u2", 10],
    ]);
    expect(resolveWeekWinners(map, ["2026-08-17"])[0].winners).toEqual(["claude"]);
  });

  it("breaks an equal head count with that day's token volume", () => {
    const map = tally([
      ["2026-08-17", "claude", "u1", 100],
      ["2026-08-17", "codex", "u2", 500],
    ]);
    expect(resolveWeekWinners(map, ["2026-08-17"])[0].winners).toEqual(["codex"]);
  });

  it("reports every tied source when users and tokens both match", () => {
    const map = tally([
      ["2026-08-17", "claude", "u1", 100],
      ["2026-08-17", "codex", "u2", 100],
      ["2026-08-17", "grok", "u3", 5],
    ]);
    const [day] = resolveWeekWinners(map, ["2026-08-17"]);
    expect(day.winners).toEqual(["claude", "codex"]);
  });

  it("keeps quiet days as explicit gaps in the row", () => {
    const map = tally([["2026-08-19", "claude", "u1"]]);
    const days = resolveWeekWinners(map, ["2026-08-17", "2026-08-18", "2026-08-19"]);
    expect(days.map((d) => d.winners)).toEqual([[], [], ["claude"]]);
    expect(days[0].counts).toEqual([]);
  });
});
