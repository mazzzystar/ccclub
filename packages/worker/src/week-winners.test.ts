import { describe, it, expect } from "vitest";
import {
  castMemberVotes,
  currentWeekDays,
  noteMemberBlock,
  resolveWeekWinners,
  weekWindowUtc,
} from "./week-winners.js";
import type { MemberWeek, WeekTally } from "./week-winners.js";

const UTC8 = 480;

/** Records one member's week as [day, source, tokens] rows and casts their votes. */
function member(tally: WeekTally, rows: Array<[string, string, number]>): void {
  const week: MemberWeek = new Map();
  for (const [day, source, tokens] of rows) {
    noteMemberBlock(week, day, source as never, tokens);
  }
  castMemberVotes(tally, week);
}

function winnersOf(tally: WeekTally, day: string) {
  return resolveWeekWinners(tally, [day])[0];
}

describe("currentWeekDays", () => {
  it("runs Monday through today and grows one slot per day", () => {
    // 2026-08-19 is a Wednesday.
    const wed = Date.parse("2026-08-19T10:00:00Z");
    expect(currentWeekDays(wed, 0)).toEqual(["2026-08-17", "2026-08-18", "2026-08-19"]);
    expect(currentWeekDays(Date.parse("2026-08-17T00:30:00Z"), 0)).toEqual(["2026-08-17"]);
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
    const { startMs, endMs } = weekWindowUtc(Date.parse("2026-08-19T10:00:00Z"), 0);
    expect(new Date(startMs).toISOString()).toBe("2026-08-17T00:00:00.000Z");
    expect(endMs - startMs).toBe(7 * 86_400_000);
  });

  it("shifts the boundary by the viewer's offset", () => {
    const { startMs } = weekWindowUtc(Date.parse("2026-08-19T10:00:00Z"), UTC8);
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

describe("one vote per member per day", () => {
  it("gives a member's whole day to the agent they used most", () => {
    const tally: WeekTally = new Map();
    // Split day, Codex heavier — the member's single vote goes to Codex.
    member(tally, [["2026-08-17", "claude", 3_000], ["2026-08-17", "codex", 9_000]]);
    const day = winnersOf(tally, "2026-08-17");
    expect(day.winners).toEqual(["codex"]);
    expect(day.counts).toEqual([{ source: "codex", users: 1 }]);
  });

  it("never lets one member vote twice, however many agents they touch", () => {
    const tally: WeekTally = new Map();
    member(tally, [
      ["2026-08-17", "claude", 5_000],
      ["2026-08-17", "codex", 100],
      ["2026-08-17", "grok", 50],
    ]);
    const day = winnersOf(tally, "2026-08-17");
    expect(day.counts.reduce((sum, c) => sum + c.users, 0)).toBe(1);
    expect(day.winners).toEqual(["claude"]);
  });

  it("counts a member once no matter how many blocks they synced", () => {
    const tally: WeekTally = new Map();
    member(tally, [
      ["2026-08-17", "claude", 10],
      ["2026-08-17", "claude", 10],
      ["2026-08-17", "claude", 10],
    ]);
    expect(winnersOf(tally, "2026-08-17").counts).toEqual([{ source: "claude", users: 1 }]);
  });

  it("elects the majority's main agent, not the loudest member", () => {
    const tally: WeekTally = new Map();
    // A whale on Codex against two lighter Claude users.
    member(tally, [["2026-08-17", "codex", 900_000_000]]);
    member(tally, [["2026-08-17", "claude", 20]]);
    member(tally, [["2026-08-17", "claude", 20]]);
    const day = winnersOf(tally, "2026-08-17");
    expect(day.winners).toEqual(["claude"]);
    expect(day.counts).toEqual([
      { source: "claude", users: 2 },
      { source: "codex", users: 1 },
    ]);
  });

  it("keeps a member's vote where their work was, not where their dabbling was", () => {
    const tally: WeekTally = new Map();
    // Everyone touches Codex briefly but works in Claude: Claude should win.
    for (let i = 0; i < 3; i++) {
      member(tally, [["2026-08-17", "claude", 50_000], ["2026-08-17", "codex", 500]]);
    }
    expect(winnersOf(tally, "2026-08-17").counts).toEqual([{ source: "claude", users: 3 }]);
  });

  it("votes per day, so a member can back different agents across the week", () => {
    const tally: WeekTally = new Map();
    member(tally, [["2026-08-17", "claude", 900], ["2026-08-18", "codex", 900]]);
    const [mon, tue] = resolveWeekWinners(tally, ["2026-08-17", "2026-08-18"]);
    expect(mon.winners).toEqual(["claude"]);
    expect(tue.winners).toEqual(["codex"]);
  });

  it("still elects an agent on a day whose blocks carry no billable tokens", () => {
    const tally: WeekTally = new Map();
    member(tally, [
      ["2026-08-17", "codex", 0],
      ["2026-08-17", "codex", 0],
      ["2026-08-17", "claude", 0],
    ]);
    expect(winnersOf(tally, "2026-08-17").winners).toEqual(["codex"]);
  });
});

describe("resolveWeekWinners", () => {
  it("breaks an equal vote count with the voters' token volume", () => {
    const tally: WeekTally = new Map();
    member(tally, [["2026-08-17", "claude", 100]]);
    member(tally, [["2026-08-17", "codex", 500]]);
    expect(winnersOf(tally, "2026-08-17").winners).toEqual(["codex"]);
  });

  it("reports every tied agent when votes and tokens both match", () => {
    const tally: WeekTally = new Map();
    member(tally, [["2026-08-17", "claude", 100]]);
    member(tally, [["2026-08-17", "codex", 100]]);
    member(tally, [["2026-08-17", "grok", 5]]);
    expect(winnersOf(tally, "2026-08-17").winners).toEqual(["claude", "codex"]);
  });

  it("keeps quiet days as explicit gaps in the row", () => {
    const tally: WeekTally = new Map();
    member(tally, [["2026-08-19", "claude", 100]]);
    const days = resolveWeekWinners(tally, ["2026-08-17", "2026-08-18", "2026-08-19"]);
    expect(days.map((d) => d.winners)).toEqual([[], [], ["claude"]]);
    expect(days[0].counts).toEqual([]);
  });

  it("orders the tooltip breakdown by votes", () => {
    const tally: WeekTally = new Map();
    member(tally, [["2026-08-17", "grok", 10]]);
    member(tally, [["2026-08-17", "claude", 10]]);
    member(tally, [["2026-08-17", "claude", 10]]);
    expect(winnersOf(tally, "2026-08-17").counts).toEqual([
      { source: "claude", users: 2 },
      { source: "grok", users: 1 },
    ]);
  });
});
