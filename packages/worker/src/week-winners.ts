// Daily "winning agent" for a group's current week, decided by an election:
// every member who coded that day casts exactly one vote, for whichever agent
// they worked with most that day. Most votes wins.
//
// One vote per member, not per agent-touched: in a group where nearly everyone
// runs both Claude Code and Codex, counting every agent someone touched makes
// both totals approach the head count and the margin becomes noise. A single
// vote for the member's main agent measures preference instead of exposure.
//
// Tokens never decide the day directly, so one member running a huge job
// cannot speak for everybody — they only break a tie between equal votes.
import type { AgentSource, DayWinner } from "@ccclub/shared";

export type { DayWinner };

interface SourceStanding {
  votes: number;
  /** Non-cache tokens contributed by this source's voters — tie-break only. */
  tokens: number;
}

/** day -> source -> standing. One shared tally for the whole group. */
export type WeekTally = Map<string, Map<AgentSource, SourceStanding>>;

interface MemberSourceDay {
  tokens: number;
  blocks: number;
}

/** day -> source -> one member's own usage, before their vote is resolved. */
export type MemberWeek = Map<string, Map<AgentSource, MemberSourceDay>>;

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
  const startMs = midnight - sinceMonday * DAY_MS - tzMinutes * 60_000;
  return { startMs, endMs: startMs + 7 * DAY_MS };
}

/**
 * Elapsed days of the current week, Monday through today. The UI pads the row
 * out to seven, so days that have not happened yet stay empty slots rather
 * than being reported as "nobody coded".
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

/** Adds one block to the member-local scratch tally the vote is derived from. */
export function noteMemberBlock(
  week: MemberWeek,
  day: string,
  source: AgentSource,
  tokens: number,
): void {
  let bySource = week.get(day);
  if (bySource == null) {
    bySource = new Map();
    week.set(day, bySource);
  }
  const current = bySource.get(source);
  if (current == null) {
    bySource.set(source, { tokens, blocks: 1 });
    return;
  }
  current.tokens += tokens;
  current.blocks += 1;
}

/**
 * Turns one member's week into at most one vote per day and folds it into the
 * group tally. Blocks decide a token tie so a day of cache-only work still
 * elects the agent that member actually sat in.
 */
export function castMemberVotes(tally: WeekTally, week: MemberWeek): void {
  for (const [day, bySource] of week) {
    let best: { source: AgentSource; tokens: number } | null = null;
    let bestBlocks = 0;
    for (const [source, usage] of bySource) {
      const better = best == null ||
        usage.tokens > best.tokens ||
        (usage.tokens === best.tokens && usage.blocks > bestBlocks) ||
        (usage.tokens === best.tokens && usage.blocks === bestBlocks && source < best.source);
      if (better) {
        best = { source, tokens: usage.tokens };
        bestBlocks = usage.blocks;
      }
    }
    if (best == null) continue;

    let standings = tally.get(day);
    if (standings == null) {
      standings = new Map();
      tally.set(day, standings);
    }
    const standing = standings.get(best.source);
    if (standing == null) {
      standings.set(best.source, { votes: 1, tokens: best.tokens });
    } else {
      standing.votes += 1;
      standing.tokens += best.tokens;
    }
  }
}

/**
 * Resolve one winner per elapsed day. Days nobody coded still appear, with an
 * empty `winners` — the row should show the gap, not silently shorten.
 */
export function resolveWeekWinners(tally: WeekTally, days: string[]): DayWinner[] {
  return days.map((day) => {
    const standings = tally.get(day);
    if (standings == null || standings.size === 0) {
      return { day, winners: [], counts: [] };
    }

    const ranked = Array.from(standings.entries())
      .map(([source, standing]) => ({ source, users: standing.votes, tokens: standing.tokens }))
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
