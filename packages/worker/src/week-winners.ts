// Daily "winning agent" for the current week: which coding agent the most
// distinct members of a group used on each elapsed day. Pure logic, kept out
// of the route so it can be tested without KV or wasm.
//
// Head-count, not tokens: one whale running a million-token job should not
// decide the day for everybody else. Tokens only break a head-count tie.
import type { AgentSource, DayWinner } from "@ccclub/shared";

export type { DayWinner };

interface DayBucket {
  users: Set<string>;
  tokens: number;
}

export type WeekTally = Map<string, Map<AgentSource, DayBucket>>;

const DAY_MS = 86_400_000;

/** Local midnight of `ms`, as a local-shifted timestamp (not real UTC). */
function localMidnight(ms: number, tzMinutes: number): number {
  const local = new Date(ms + tzMinutes * 60_000);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
}

/**
 * Real-UTC window covering the current ISO week (Monday 00:00 local through
 * next Monday 00:00 local). Used to skip blocks before any per-day work.
 */
export function weekWindowUtc(nowMs: number, tzMinutes: number): { startMs: number; endMs: number } {
  const midnight = localMidnight(nowMs, tzMinutes);
  const dayOfWeek = new Date(midnight).getUTCDay(); // 0 = Sunday
  const sinceMonday = (dayOfWeek + 6) % 7;
  const startLocal = midnight - sinceMonday * DAY_MS;
  const startMs = startLocal - tzMinutes * 60_000;
  return { startMs, endMs: startMs + 7 * DAY_MS };
}

/**
 * Elapsed days of the current week, Monday through today. The UI pads the
 * row out to seven, so days that have not happened yet stay empty slots
 * rather than being reported as "nobody coded".
 */
export function currentWeekDays(nowMs: number, tzMinutes: number): string[] {
  const midnight = localMidnight(nowMs, tzMinutes);
  const dayOfWeek = new Date(midnight).getUTCDay();
  const sinceMonday = (dayOfWeek + 6) % 7;
  const days: string[] = [];
  for (let back = sinceMonday; back >= 0; back--) {
    days.push(new Date(midnight - back * DAY_MS).toISOString().slice(0, 10));
  }
  return days;
}

/** Records that `userId` used `source` on `day`. Repeat blocks are idempotent. */
export function tallyDay(
  tally: WeekTally,
  day: string,
  source: AgentSource,
  userId: string,
  tokens: number,
): void {
  let bySource = tally.get(day);
  if (bySource == null) {
    bySource = new Map();
    tally.set(day, bySource);
  }
  let bucket = bySource.get(source);
  if (bucket == null) {
    bucket = { users: new Set(), tokens: 0 };
    bySource.set(source, bucket);
  }
  bucket.users.add(userId);
  bucket.tokens += tokens;
}

/**
 * Resolve one winner per elapsed day. Days nobody coded still appear, with an
 * empty `winners` — the row should show the gap, not silently shorten.
 */
export function resolveWeekWinners(tally: WeekTally, days: string[]): DayWinner[] {
  return days.map((day) => {
    const bySource = tally.get(day);
    if (bySource == null || bySource.size === 0) {
      return { day, winners: [], counts: [] };
    }

    const ranked = Array.from(bySource.entries())
      .map(([source, bucket]) => ({ source, users: bucket.users.size, tokens: bucket.tokens }))
      .filter((row) => row.users > 0)
      .sort((a, b) => b.users - a.users || b.tokens - a.tokens || a.source.localeCompare(b.source));

    if (ranked.length === 0) return { day, winners: [], counts: [] };

    const top = ranked[0];
    const winners = ranked
      .filter((row) => row.users === top.users && row.tokens === top.tokens)
      .map((row) => row.source);

    return {
      day,
      winners,
      counts: ranked.map((row) => ({ source: row.source, users: row.users })),
    };
  });
}
