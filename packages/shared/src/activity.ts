// Daily-activity statistics shared by the web activity page (worker) and
// `ccclub activity` (CLI), so streaks mean the same thing everywhere. Keys
// are calendar days ("YYYY-MM-DD") in whatever timezone the caller chose.

export interface DayTotal {
  d: string; // YYYY-MM-DD
  tokens: number;
  cost: number;
  chats: number;
}

export interface ActivityStats {
  totalTokens: number;
  totalCost: number;
  activeDays: number;
  peakDay: string | null;
  peakDayTokens: number;
  /** Consecutive active days ending today — or yesterday, when today is still empty. */
  currentStreak: number;
  longestStreak: number;
}

const DAY_MS = 86_400_000;

export function computeActivityStats(days: Map<string, DayTotal>, todayKey: string): ActivityStats {
  let totalTokens = 0;
  let totalCost = 0;
  let peakDay: string | null = null;
  let peakDayTokens = 0;
  for (const day of days.values()) {
    totalTokens += day.tokens;
    totalCost += day.cost;
    if (day.tokens > peakDayTokens) {
      peakDayTokens = day.tokens;
      peakDay = day.d;
    }
  }

  // Streaks over calendar days. Walk the sorted active days once; a gap of
  // more than one day breaks a run.
  const sorted = [...days.keys()].sort();
  let longest = 0;
  let run = 0;
  let prevMs = NaN;
  let lastRunEnd = "";
  for (const key of sorted) {
    const ms = Date.parse(`${key}T00:00:00Z`);
    run = ms - prevMs === DAY_MS ? run + 1 : 1;
    prevMs = ms;
    if (run > longest) longest = run;
    lastRunEnd = key;
  }

  // The trailing run is "current" only while it can still be extended: it
  // must reach today, or yesterday (today simply hasn't had activity yet).
  let current = 0;
  if (sorted.length > 0) {
    const endMs = Date.parse(`${lastRunEnd}T00:00:00Z`);
    const todayMs = Date.parse(`${todayKey}T00:00:00Z`);
    if (todayMs - endMs <= DAY_MS) {
      current = 1;
      for (let i = sorted.length - 2; i >= 0; i--) {
        if (Date.parse(`${sorted[i + 1]}T00:00:00Z`) - Date.parse(`${sorted[i]}T00:00:00Z`) === DAY_MS) current++;
        else break;
      }
    }
  }

  return {
    totalTokens,
    totalCost,
    activeDays: days.size,
    peakDay,
    peakDayTokens,
    currentStreak: current,
    longestStreak: longest,
  };
}

/**
 * Absolute intensity scale for activity heatmaps, shared by the CLI and the
 * web page so the same day renders the same level everywhere.
 *
 * Levels are log-spaced bands of daily total tokens, grouped into four hue
 * tiers: green (light), amber (moderate), orange (heavy), gold (extreme).
 * Hue encodes the order of magnitude — so two people's pages differ at a
 * glance — and depth within a hue encodes position inside the band. A
 * per-user relative scale would render a 1M/day and a 1B/day user
 * identically, which is exactly the information a leaderboard cares about.
 */
export const ACTIVITY_LEVEL_THRESHOLDS = [
  1,             // L1 dim green
  10_000_000,    // L2 green
  50_000_000,    // L3 olive
  200_000_000,   // L4 amber
  500_000_000,   // L5 deep orange
  1_000_000_000, // L6 orange
  2_000_000_000, // L7 gold
  5_000_000_000, // L8 blazing gold
] as const;

/** 0 (no activity) through 8 (≥5B tokens). */
export function activityLevelFor(tokens: number): number {
  let level = 0;
  for (const min of ACTIVITY_LEVEL_THRESHOLDS) {
    if (tokens >= min) level++;
    else break;
  }
  return level;
}
