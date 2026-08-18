import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "../config.js";
import { collectUsageEntries } from "../collector.js";
import { parseSources } from "../sources/index.js";
import { aggregateToBlocks } from "../aggregator.js";
import { loadPricing } from "../pricing.js";
import { createScanCacheFactory } from "../scan-cache.js";
import { theme } from "../theme.js";
import { DEFAULT_SOURCES, isRankedSource, computeActivityStats } from "@ccclub/shared";
import type { DayTotal, UsageBlock } from "@ccclub/shared";

// GitHub-style yearly heatmap of local coding-agent activity, computed from
// the same local logs the leaderboard syncs — works offline, nothing fetched.

const DAY_MS = 86_400_000;
const WEEKS = 53;

/** Machine-local calendar day, YYYY-MM-DD. */
export function localDayKeyOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Sum ranked blocks into machine-local days. keyOf is injectable for tests. */
export function buildDayTotals(
  blocks: UsageBlock[],
  keyOf: (d: Date) => string = localDayKeyOf,
): Map<string, DayTotal> {
  const days = new Map<string, DayTotal>();
  for (const block of blocks) {
    if (!isRankedSource(block.source)) continue;
    const date = new Date(block.blockStart);
    if (isNaN(date.getTime())) continue;
    const key = keyOf(date);
    const day = days.get(key) ?? { d: key, tokens: 0, cost: 0, chats: 0 };
    day.tokens += block.totalTokens || 0;
    day.cost += block.costUSD || 0;
    day.chats += block.chatCount || 0;
    days.set(key, day);
  }
  return days;
}

/** Intensity 0–4 from quartiles of the non-zero days, GitHub-style. */
export function levelThresholds(tokensByDay: Map<string, number>): number[] {
  const nonZero = [...tokensByDay.values()].filter((v) => v > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return [0, 0, 0];
  // ceil-1, not floor: with floor, q(0.75) of a small sample is its maximum
  // and the brightest level is unreachable.
  const q = (p: number) => nonZero[Math.max(0, Math.ceil(p * nonZero.length) - 1)];
  return [q(0.25), q(0.5), q(0.75)];
}

export function levelFor(tokens: number, thresholds: number[]): number {
  if (tokens <= 0) return 0;
  for (let i = 0; i < thresholds.length; i++) if (tokens <= thresholds[i]) return i + 1;
  return 4;
}

export interface HeatmapPaint {
  cell(level: number): string;
  future(): string;
  label(text: string): string;
}

const PLAIN_PAINT: HeatmapPaint = {
  cell: (level) => String(level),
  future: () => " ",
  label: (text) => text,
};

/**
 * Render the 53-week grid as terminal lines: a month-label header, seven
 * weekday rows (Sun..Sat, matching the web page), and a legend. Day keys are
 * treated as opaque calendar days; all arithmetic is UTC on purpose.
 */
export function heatmapLines(
  tokensByDay: Map<string, number>,
  todayKey: string,
  paint: HeatmapPaint = PLAIN_PAINT,
): string[] {
  const thresholds = levelThresholds(tokensByDay);
  const todayMs = Date.parse(`${todayKey}T00:00:00Z`);
  const weekStart = todayMs - new Date(todayMs).getUTCDay() * DAY_MS; // this week's Sunday
  const firstWeek = weekStart - (WEEKS - 1) * 7 * DAY_MS;

  // Month labels above the first full week of each month, greedily placed so
  // a label never collides with the previous one.
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let header = "";
  let lastMonth = -1;
  for (let w = 0; w < WEEKS; w++) {
    const wk = new Date(firstWeek + w * 7 * DAY_MS);
    if (wk.getUTCMonth() !== lastMonth && wk.getUTCDate() <= 7) {
      lastMonth = wk.getUTCMonth();
      if (header.length <= w) {
        header = header.padEnd(w) + MONTHS[lastMonth];
        continue;
      }
    }
    header = header.padEnd(w + 1);
  }

  const GUTTER = 4;
  const lines: string[] = [" ".repeat(GUTTER) + paint.label(header.trimEnd())];
  const DOW = ["    ", "Mon ", "    ", "Wed ", "    ", "Fri ", "    "];
  for (let dow = 0; dow < 7; dow++) {
    let row = paint.label(DOW[dow]);
    for (let w = 0; w < WEEKS; w++) {
      const ms = firstWeek + (w * 7 + dow) * DAY_MS;
      if (ms > todayMs) {
        row += paint.future();
        continue;
      }
      const key = new Date(ms).toISOString().slice(0, 10);
      row += paint.cell(levelFor(tokensByDay.get(key) ?? 0, thresholds));
    }
    lines.push(row);
  }
  lines.push(
    " ".repeat(GUTTER) +
      paint.label("Less ") + paint.cell(0) + paint.cell(1) + paint.cell(2) + paint.cell(3) + paint.cell(4) + paint.label(" More"),
  );
  return lines;
}

export function formatTokensShort(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

const ANSI_PAINT: HeatmapPaint = {
  cell: (level) =>
    [
      chalk.hex("#3a3530")("·"),
      chalk.hex("#7c4e2a")("■"),
      chalk.hex("#a3612f")("■"),
      chalk.hex("#c07d43")("■"),
      chalk.hex("#d4935e")("■"),
    ][level],
  future: () => " ",
  label: (text) => chalk.hex("#5a5550")(text),
};

export async function activityCommand(options: { json?: boolean } = {}): Promise<void> {
  const spinner = options.json || !process.stdout.isTTY ? null : ora("Reading local usage logs...").start();

  const { calculateCost } = await loadPricing();
  const collectSources = process.env.CCCLUB_SOURCES?.trim()
    ? parseSources(process.env.CCCLUB_SOURCES)
    : [...DEFAULT_SOURCES];
  const { entries, humanTurns } = await collectUsageEntries({
    sources: collectSources,
    calculateCost,
    openScanCache: createScanCacheFactory(),
  });
  const blocks = aggregateToBlocks(entries, humanTurns);
  if (spinner) spinner.stop();

  const days = buildDayTotals(blocks);
  const todayKey = localDayKeyOf(new Date());
  const stats = computeActivityStats(days, todayKey);
  const config = await loadConfig();

  if (options.json) {
    const list = [...days.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
    console.log(JSON.stringify({ today: todayKey, stats, days: list }, null, 2));
    return;
  }

  if (days.size === 0) {
    console.log(theme.muted("\n  No local coding-agent usage found yet.\n"));
    return;
  }

  const name = config?.displayName ? `${config.displayName} — ` : "";
  console.log("");
  console.log("  " + theme.text(`${name}token activity`));
  console.log("");
  console.log(
    "  " +
      theme.title(formatTokensShort(stats.totalTokens)) + theme.muted(" total") +
      theme.muted("  ·  ") + theme.title(formatTokensShort(stats.peakDayTokens)) + theme.muted(` best day${stats.peakDay ? ` (${stats.peakDay})` : ""}`) +
      theme.muted("  ·  ") + theme.title(String(stats.activeDays)) + theme.muted(" active days") +
      theme.muted("  ·  ") + theme.title(String(stats.currentStreak)) + theme.muted(` day streak (best ${stats.longestStreak})`),
  );
  console.log("");

  const tokensByDay = new Map([...days.values()].map((d) => [d.d, d.tokens]));
  for (const line of heatmapLines(tokensByDay, todayKey, ANSI_PAINT)) {
    console.log("  " + line);
  }
  console.log("");
  if (config?.userId) {
    console.log(theme.muted("  Web version: ") + theme.link(`https://ccclub.dev/u/${config.userId}`));
    console.log("");
  }
}
