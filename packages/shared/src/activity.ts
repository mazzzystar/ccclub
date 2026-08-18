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
