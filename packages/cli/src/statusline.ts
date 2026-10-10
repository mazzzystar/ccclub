import { readFileSync } from "node:fs";
import { writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { CCCLUB_CONFIG_DIR } from "@ccclub/shared";
import type { UsageSnapshot } from "@ccclub/shared";

// The render path is executed by Claude Code on every turn, so it must stay
// fast and side-effect free: read stdin + two small cache files, print one
// line. All cache refreshing happens in `ccclub sync`, which the Stop /
// SessionEnd hooks and the heartbeat already run while Claude Code is in use —
// and which statusline-cli.ts may start once the line has been printed, when
// those two have been asleep (see statusline-refresh.ts).
//
// The 5h/7d numbers have a second, faster source: Claude Code puts the
// `rate_limits` it read off its latest API response into the stdin payload.
// That costs nothing to read and is current to the session's last turn, where
// the cache trails by a sync interval at best — measured at +9 points inside
// five minutes of heavy use. See resolveLimit for how the two are combined.
// Fable's weekly limit is not in that payload, and neither is anything another
// session spent, so a session that sees the cache fall behind also starts a
// limits-only refresh (statusline-refresh.ts) — one request, no log scan.

// Two ages bound the caches. Past USAGE_MAX_AGE_MS a snapshot no longer
// describes the current 5-hour window, but hiding it outright is worse than
// showing it: the LaunchAgent's 5-minute interval is suppressed while the
// laptop sleeps, so a slept-through night used to make the limits segment
// vanish for hours with nothing to explain why. Stale numbers render dim with
// a trailing `~` instead — visibly not live, still better than nothing.
export const USAGE_MAX_AGE_MS = 3 * 60 * 60 * 1000;
// Past this, nothing renders: half a day on, the 5-hour window has turned
// over completely and the numbers would be a lie rather than a stale truth.
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

// Raw ANSI (no chalk): the statusline binary avoids external imports to keep
// startup latency low. Colors mirror theme.ts / cc-costline conventions.
const MODEL = "\x1b[38;2;212;147;94m"; // theme.brand
const DIM = "\x1b[38;5;102m";
const GREEN = "\x1b[38;2;99;180;134m"; // theme.success
const WARN = "\x1b[38;2;212;168;92m"; // theme.warning
const DANGER = "\x1b[38;2;210;106;106m"; // theme.danger
const GOLD = "\x1b[38;2;214;181;109m"; // theme.gold
const SILVER = "\x1b[38;2;235;235;235m";
const BRONZE = "\x1b[38;2;197;138;97m"; // theme.bronze
const CYAN = "\x1b[38;2;122;183;198m"; // theme.linkText
const RESET = "\x1b[0m";

// /effort levels, colored by intensity. Unknown (future) levels render DIM
// rather than disappearing.
const EFFORT_COLORS: Record<string, string> = {
  low: DIM,
  medium: CYAN,
  high: GREEN,
  xhigh: WARN,
  max: DANGER,
};

export function getUsageCachePath(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "usage-cache.json");
}

export function getRankCachePath(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "rank-cache.json");
}

/** A model-scoped weekly limit, e.g. the Fable cap that `/usage` reports. */
export interface ModelWeekly {
  label: string;
  percent: number;
}

/** Written only by `ccclub sync`; see writeModelWeekly in usage-limits.ts. */
export function getModelWeeklyPath(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "model-weekly.json");
}

interface RankCacheEntry {
  rank: number;
  total: number;
  costUSD: number;
  fetchedAt: number;
  /** Group dashboard URL; the rank segment becomes a terminal hyperlink. */
  url?: string;
}

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return value != null && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Everything rendered here lands raw in the terminal between our own ANSI
 * codes, and both stdin (Claude Code's payload, influenced by the open repo's
 * settings) and the cache files are outside this process's control — so any
 * string from either goes through this: printable ASCII only (drops ESC, BEL,
 * and friends), bounded length, truncated before the trim so a cut mid-word
 * can't leave trailing space.
 */
function printable(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[^\x20-\x7E]/g, "").slice(0, maxLength).trim();
}

/** Age in ms, or null when the timestamp is missing, future-dated, or too old. */
function validAge(fetchedAt: number | null, now: number, maxAgeMs: number): number | null {
  if (fetchedAt == null) return null;
  const age = now - fetchedAt;
  return age >= 0 && age <= maxAgeMs ? age : null;
}

/** A usable cache value; `stale` marks one past USAGE_MAX_AGE_MS. */
interface CacheRead<T> {
  value: T;
  stale: boolean;
  fetchedAt: number;
}

const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;

/** One window of Claude Code's `rate_limits` stdin field. */
export interface LiveLimit {
  percent: number;
  /** Epoch ms at which this window turns over. */
  resetsAt: number;
}

/**
 * A window whose reset time has passed is dropped: the session has been idle
 * since before the turnover, so its percentage describes a window that no
 * longer exists. Claude Code sends resets_at in epoch seconds; milliseconds
 * are tolerated the same way isTokenExpired tolerates the opposite drift.
 */
function readLiveLimit(value: unknown, now: number): LiveLimit | null {
  const raw = value as { used_percentage?: unknown; resets_at?: unknown } | null | undefined;
  const percent = asFiniteNumber(raw?.used_percentage);
  const resets = asFiniteNumber(raw?.resets_at);
  if (percent == null || resets == null || resets <= 0) return null;
  const resetsAt = resets > 1e11 ? resets : resets * 1000;
  if (resetsAt <= now) return null;
  return { percent: Math.max(0, Math.min(100, percent)), resetsAt };
}

/** Both windows as this session last saw them; null where absent or expired. */
function readLiveLimits(data: Record<string, unknown>, now: number): {
  fiveHour: LiveLimit | null;
  sevenDay: LiveLimit | null;
} {
  const raw = data.rate_limits as { five_hour?: unknown; seven_day?: unknown } | null | undefined;
  return {
    fiveHour: readLiveLimit(raw?.five_hour, now),
    sevenDay: readLiveLimit(raw?.seven_day, now),
  };
}

/**
 * Whether the cache has yet to catch up with what this session saw: there is
 * no usable cache, it predates the window, or its (rounded, as displayed)
 * number is lower. The statusline's cue that a refresh would change something.
 */
function isAheadOfCache(live: LiveLimit | null, cached: CacheRead<number> | null, windowMs: number): boolean {
  if (live == null) return false;
  if (cached == null || cached.fetchedAt < live.resetsAt - windowMs) return true;
  return Math.round(live.percent) > Math.round(cached.value);
}

/** What the limits-refresh policy needs to know about one render. */
export interface LimitsLead {
  /** Windows where this session is ahead of the cache; null where it is not. */
  fiveHour: LiveLimit | null;
  sevenDay: LiveLimit | null;
  /** When the usage cache was fetched; null when there is none to speak of. */
  cacheFetchedAt: number | null;
}

/**
 * The same two inputs renderStatusline reads, reduced to "is there news the
 * cache lacks". Kept apart from rendering so that stays a pure string
 * function; the cost is one more parse of a payload a few hundred bytes long.
 */
export function readLimitsLead(
  input: string,
  options: { now?: number; usageCachePath?: string } = {},
): LimitsLead {
  const none: LimitsLead = { fiveHour: null, sevenDay: null, cacheFetchedAt: null };
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(input) as unknown;
    if (parsed == null || typeof parsed !== "object") return none;
    data = parsed as Record<string, unknown>;
  } catch {
    return none;
  }
  const now = options.now ?? Date.now();
  const live = readLiveLimits(data, now);
  const usage = readUsageCache(options.usageCachePath ?? getUsageCachePath(), now);
  const cached = (value: number | undefined): CacheRead<number> | null =>
    usage != null && value != null ? { value, stale: usage.stale, fetchedAt: usage.fetchedAt } : null;
  return {
    fiveHour: isAheadOfCache(live.fiveHour, cached(usage?.value.fiveHour), FIVE_HOUR_MS) ? live.fiveHour : null,
    sevenDay: isAheadOfCache(live.sevenDay, cached(usage?.value.sevenDay), SEVEN_DAY_MS) ? live.sevenDay : null,
    cacheFetchedAt: usage?.fetchedAt ?? null,
  };
}

/**
 * Pick the number to show for one window. The stdin value is only as recent
 * as this session's last API response — an idle session keeps reporting what
 * it saw hours ago while another one spends — so it does not simply replace
 * the cache. Inside a single window usage only climbs, which makes the higher
 * of the two the more recent, as long as the cache was fetched inside the same
 * window; one fetched before the window began says nothing about it.
 */
function resolveLimit(
  live: LiveLimit | null,
  cached: CacheRead<number> | null,
  windowMs: number,
): { percent: number; stale: boolean } | null {
  if (live == null) return cached ? { percent: cached.value, stale: cached.stale } : null;
  const sameWindow = cached != null && cached.fetchedAt >= live.resetsAt - windowMs;
  return { percent: sameWindow ? Math.max(live.percent, cached.value) : live.percent, stale: false };
}

function readUsageCache(path: string, now: number): CacheRead<UsageSnapshot> | null {
  const raw = readJsonFile(path);
  const snapshot = raw?.snapshot as UsageSnapshot | undefined;
  const fetchedAt = asFiniteNumber(raw?.fetchedAt);
  const age = validAge(fetchedAt, now, MAX_AGE_MS);
  if (
    snapshot == null ||
    fetchedAt == null ||
    age == null ||
    asFiniteNumber(snapshot.fiveHour) == null ||
    asFiniteNumber(snapshot.sevenDay) == null
  ) {
    return null;
  }
  return { value: snapshot, stale: age > USAGE_MAX_AGE_MS, fetchedAt };
}

function readModelWeekly(path: string, now: number): CacheRead<ModelWeekly> | null {
  const raw = readJsonFile(path);
  const percent = asFiniteNumber(raw?.percent);
  const fetchedAt = asFiniteNumber(raw?.fetchedAt);
  const age = validAge(fetchedAt, now, MAX_AGE_MS);
  if (percent == null || fetchedAt == null || age == null) return null;
  // A malformed entry drops just this segment; an out-of-range percent is
  // clamped rather than rendered raw.
  const label = printable(raw?.label, 20);
  if (!label) return null;
  return {
    value: { label, percent: Math.max(0, Math.min(100, percent)) },
    stale: age > USAGE_MAX_AGE_MS,
    fetchedAt,
  };
}

function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

// The url is embedded verbatim in an OSC 8 sequence, so beyond the scheme it
// must contain nothing a terminal could read as a control byte: printable
// ASCII without spaces, bounded length. A prefix check alone would let an
// embedded ESC or BEL terminate the sequence early and feed the remainder to
// the terminal raw.
const SAFE_URL = /^https?:\/\/[\x21-\x7E]{1,240}$/;

function readRankCache(path: string, now: number): RankCacheEntry | null {
  const raw = readJsonFile(path);
  const rank = asFiniteNumber(raw?.rank);
  const total = asFiniteNumber(raw?.total);
  const costUSD = asFiniteNumber(raw?.costUSD);
  const fetchedAt = asFiniteNumber(raw?.fetchedAt);
  if (rank == null || total == null || costUSD == null || fetchedAt == null) return null;
  // Rank shows *today's* cost, so besides the age cap it must be from today.
  if (validAge(fetchedAt, now, MAX_AGE_MS) == null || !isSameLocalDay(fetchedAt, now)) return null;
  const url = typeof raw?.url === "string" && SAFE_URL.test(raw.url) ? raw.url : undefined;
  return { rank, total, costUSD, fetchedAt, url };
}

/**
 * OSC 8 terminal hyperlink: invisible wrapper, so the UI is unchanged —
 * supporting terminals (Ghostty, iTerm2, VS Code, …) make the text
 * cmd/ctrl-clickable; others ignore the sequence and show plain text.
 */
function hyperlink(text: string, url: string | undefined): string {
  if (!url) return text;
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

export function formatCost(n: number): string {
  if (n >= 1000) return "$" + Math.round(n).toLocaleString("en-US");
  if (n >= 100) return "$" + n.toFixed(0);
  if (n >= 10) return "$" + n.toFixed(1);
  return "$" + n.toFixed(2);
}

function percentColor(pct: number): string {
  if (pct >= 80) return DANGER;
  if (pct >= 60) return WARN;
  return GREEN;
}

function rankColor(rank: number): string {
  if (rank === 1) return GOLD;
  if (rank === 2) return SILVER;
  if (rank === 3) return BRONZE;
  return CYAN;
}

/**
 * Build the statusline from Claude Code's stdin JSON plus local caches.
 * Segments degrade independently: anything unavailable is silently omitted.
 *
 * Example: ` Fable 5 xhigh | 5h: 15% / 7d: 43% / Fable: 8% | #11/67 $19.0`
 * Stale limits keep their place, dimmed: ` … | 5h: 15% / 7d: 43% ~ | …`
 */
export function renderStatusline(
  input: string,
  options: {
    now?: number;
    usageCachePath?: string;
    rankCachePath?: string;
    modelWeeklyPath?: string;
  } = {},
): string {
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(input) as unknown;
    if (parsed == null || typeof parsed !== "object") return "";
    data = parsed as Record<string, unknown>;
  } catch {
    return "";
  }

  const now = options.now ?? Date.now();
  const segments: string[] = [];

  const modelName = printable((data.model as { display_name?: unknown } | undefined)?.display_name, 40);
  const modelParts: string[] = [];
  if (modelName) {
    // "Fable 5 (200K context)" → "Fable 5 ($1)"-style shortening, as cc-costline does.
    const model = modelName.replace(/\s*\((\d+[KMB])\s+context\)/i, " ($1)").trim();
    modelParts.push(`${MODEL}${model}${RESET}`);
  }
  // Session-scoped reasoning effort; absent when the model has no effort knob.
  const level = printable((data.effort as { level?: unknown } | undefined)?.level, 12).toLowerCase();
  if (level) {
    modelParts.push(`${EFFORT_COLORS[level] ?? DIM}${level}${RESET}`);
  }
  if (modelParts.length > 0) segments.push(modelParts.join(" "));

  const usage = readUsageCache(options.usageCachePath ?? getUsageCachePath(), now);
  const cachedLimit = (pick: (snapshot: UsageSnapshot) => number): CacheRead<number> | null =>
    usage ? { value: pick(usage.value), stale: usage.stale, fetchedAt: usage.fetchedAt } : null;
  const live = readLiveLimits(data, now);
  const fiveHour = resolveLimit(live.fiveHour, cachedLimit((snapshot) => snapshot.fiveHour), FIVE_HOUR_MS);
  const sevenDay = resolveLimit(live.sevenDay, cachedLimit((snapshot) => snapshot.sevenDay), SEVEN_DAY_MS);
  if (fiveHour && sevenDay) {
    // Stale parts lose their threshold color: dim numbers plus one trailing
    // `~` say "last known" without spending a second character on it.
    const color = (pct: number, stale: boolean) => (stale ? DIM : percentColor(pct));
    const five = Math.round(fiveHour.percent);
    const seven = Math.round(sevenDay.percent);
    let seg =
      `${DIM}5h:${RESET} ${color(five, fiveHour.stale)}${five}%${RESET} ${DIM}/${RESET} ` +
      `${DIM}7d:${RESET} ${color(seven, sevenDay.stale)}${seven}%${RESET}`;
    const modelWeekly = readModelWeekly(options.modelWeeklyPath ?? getModelWeeklyPath(), now);
    if (modelWeekly) {
      const pct = Math.round(modelWeekly.value.percent);
      seg +=
        ` ${DIM}/${RESET} ${DIM}${modelWeekly.value.label}:${RESET} ` +
        `${color(pct, modelWeekly.stale)}${pct}%${RESET}`;
    }
    if (fiveHour.stale || sevenDay.stale || modelWeekly?.stale) seg += ` ${DIM}~${RESET}`;
    segments.push(seg);
  }

  const rank = readRankCache(options.rankCachePath ?? getRankCachePath(), now);
  if (rank) {
    segments.push(hyperlink(
      `${rankColor(rank.rank)}#${rank.rank}${RESET}${DIM}/${rank.total}${RESET} ` +
      `${GOLD}${formatCost(rank.costUSD)}${RESET}`,
      rank.url,
    ));
  }

  if (segments.length === 0) return "";
  return " " + segments.join(` ${DIM}|${RESET} `);
}

/**
 * Persist a rank snapshot for the statusline to read. Never throws.
 * Swapped in with a rename: the statusline reads this file on every turn, and
 * a plain write truncates first, so a read could land on an empty file.
 */
export async function writeRankCache(
  entry: { rank: number; total: number; costUSD: number; url?: string },
  cachePath = getRankCachePath(),
): Promise<void> {
  const tmp = `${cachePath}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify({ ...entry, fetchedAt: Date.now() } satisfies RankCacheEntry));
    await rename(tmp, cachePath);
  } catch {
    // Unwritable cache — the statusline just omits the segment.
    try { await rm(tmp, { force: true }); } catch { /* nothing to clean up */ }
  }
}

/**
 * Fetch today's rank for the primary group and cache it for the statusline.
 * Called from `ccclub sync` (hooks + heartbeat), so the cache stays fresh
 * exactly while Claude Code is being used. Never throws.
 */
export async function refreshRankCache(
  config: { apiUrl: string; userId: string; groups: string[] },
  cachePath = getRankCachePath(),
): Promise<void> {
  const code = config.groups[0];
  if (!code) return;

  try {
    const tz = -new Date().getTimezoneOffset();
    const res = await fetch(
      `${config.apiUrl}/api/rank/${encodeURIComponent(code)}?period=daily&tz=${tz}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) return;
    const data = (await res.json()) as { rankings?: Array<{ userId?: string; rank?: number; costUSD?: number }> };
    const rankings = Array.isArray(data.rankings) ? data.rankings : [];
    const me = rankings.find((entry) => entry.userId === config.userId);
    if (me == null || asFiniteNumber(me.rank) == null || asFiniteNumber(me.costUSD) == null) return;

    await writeRankCache(
      {
        rank: me.rank as number,
        total: rankings.length,
        costUSD: me.costUSD as number,
        url: `${config.apiUrl}/g/${encodeURIComponent(code)}`,
      },
      cachePath,
    );
  } catch {
    // Offline or server error — the statusline keeps showing the last cache
    // until it ages out.
  }
}
