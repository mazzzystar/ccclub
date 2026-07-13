import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { CCCLUB_CONFIG_DIR } from "@ccclub/shared";
import type { UsageSnapshot } from "@ccclub/shared";

// The render path is executed by Claude Code on every turn, so it must stay
// fast and side-effect free: read stdin + two small cache files, print one
// line. All cache refreshing happens in `ccclub sync`, which the Stop /
// SessionEnd hooks and the heartbeat already run while Claude Code is in use.

// Show usage limits only while reasonably fresh; an idle machine's last
// snapshot says nothing about the current 5-hour window.
const USAGE_MAX_AGE_MS = 3 * 60 * 60 * 1000;
// Rank shows *today's* cost, so besides an age cap it must be from today.
const RANK_MAX_AGE_MS = 12 * 60 * 60 * 1000;

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

export function getUsageCachePath(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "usage-cache.json");
}

export function getRankCachePath(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "rank-cache.json");
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

function readUsageCache(path: string, now: number): UsageSnapshot | null {
  const raw = readJsonFile(path);
  const snapshot = raw?.snapshot as UsageSnapshot | undefined;
  const fetchedAt = asFiniteNumber(raw?.fetchedAt);
  if (
    snapshot == null ||
    fetchedAt == null ||
    now - fetchedAt > USAGE_MAX_AGE_MS ||
    asFiniteNumber(snapshot.fiveHour) == null ||
    asFiniteNumber(snapshot.sevenDay) == null
  ) {
    return null;
  }
  return snapshot;
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

function readRankCache(path: string, now: number): RankCacheEntry | null {
  const raw = readJsonFile(path);
  const rank = asFiniteNumber(raw?.rank);
  const total = asFiniteNumber(raw?.total);
  const costUSD = asFiniteNumber(raw?.costUSD);
  const fetchedAt = asFiniteNumber(raw?.fetchedAt);
  if (rank == null || total == null || costUSD == null || fetchedAt == null) return null;
  if (now - fetchedAt > RANK_MAX_AGE_MS || !isSameLocalDay(fetchedAt, now)) return null;
  const url = typeof raw?.url === "string" && /^https?:\/\//.test(raw.url) ? raw.url : undefined;
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
 * Example: ` Fable 5 | 5h: 15% / 7d: 43% | #11/67 $19.0`
 */
export function renderStatusline(
  input: string,
  options: { now?: number; usageCachePath?: string; rankCachePath?: string } = {},
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

  const modelName = (data.model as { display_name?: unknown } | undefined)?.display_name;
  if (typeof modelName === "string" && modelName.trim()) {
    // "Fable 5 (200K context)" → "Fable 5 ($1)"-style shortening, as cc-costline does.
    const model = modelName.replace(/\s*\((\d+[KMB])\s+context\)/i, " ($1)").trim();
    segments.push(`${MODEL}${model}${RESET}`);
  }

  const usage = readUsageCache(options.usageCachePath ?? getUsageCachePath(), now);
  if (usage) {
    const five = Math.round(usage.fiveHour);
    const seven = Math.round(usage.sevenDay);
    segments.push(
      `${DIM}5h:${RESET} ${percentColor(five)}${five}%${RESET} ${DIM}/${RESET} ` +
      `${DIM}7d:${RESET} ${percentColor(seven)}${seven}%${RESET}`,
    );
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

/** Persist a rank snapshot for the statusline to read. Never throws. */
export async function writeRankCache(
  entry: { rank: number; total: number; costUSD: number; url?: string },
  cachePath = getRankCachePath(),
): Promise<void> {
  try {
    await writeFile(cachePath, JSON.stringify({ ...entry, fetchedAt: Date.now() } satisfies RankCacheEntry));
  } catch { /* unwritable cache — statusline just omits the segment */ }
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
