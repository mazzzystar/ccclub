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
 * Three hue tiers — green (everyday), gold (heavy), purple (legendary) —
 * each with a GitHub-style four-step dim-to-bright ramp: hue says which
 * class of user a page belongs to at a glance, depth within the hue gives
 * the within-page texture. Boundaries are calibrated on the real per-day
 * distribution (Aug 2026: median active day ≈ 38M, p90 ≈ 450M, p97 ≈ 1.1B)
 * so people split roughly 7:3:1 across tiers instead of 98% in one hue.
 */
export const ACTIVITY_LEVEL_THRESHOLDS = [
  1,             // green ramp: the everyday range (~62% of active days)
  10_000_000,
  30_000_000,
  60_000_000,
  100_000_000,   // gold ramp: heavy usage (~33%)
  200_000_000,
  400_000_000,
  700_000_000,
  1_000_000_000, // purple ramp: legendary (~3% of days, peak-day territory)
  1_500_000_000,
  2_500_000_000,
  4_000_000_000,
] as const;

/** 0 (no activity) through 12 (≥4B tokens). */
export function activityLevelFor(tokens: number): number {
  let level = 0;
  for (const min of ACTIVITY_LEVEL_THRESHOLDS) {
    if (tokens >= min) level++;
    else break;
  }
  return level;
}
