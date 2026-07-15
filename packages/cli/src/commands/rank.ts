import Table from "cli-table3";
import ora from "ora";
import type { AgentSource, RankingEntry, RankingPeriod, RankResponse } from "@ccclub/shared";
import { AGENT_LABELS, PLAN_PRICES } from "@ccclub/shared";
import { theme, type StyleFn } from "../theme.js";
import { requireConfig } from "../config.js";
import { formatFetchError } from "../fetch-error.js";
import { doSync, needsFullSync } from "./sync.js";
import { installHook, isHookInstalled } from "../hook.js";
import { installHeartbeat, isHeartbeatInstalled } from "../heartbeat.js";
import { getUpdateResult } from "../update-check.js";
import { fetchUsageLimits } from "../usage-limits.js";
import { maybeAutoEnableStatusline } from "../statusline-install.js";
import { writeRankCache } from "../statusline.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { CCCLUB_CONFIG_DIR } from "@ccclub/shared";

const ACTIVE_THRESHOLD_MS = 15 * 60 * 1000;
const AGENT_ORDER: AgentSource[] = ["claude", "codex", "opencode", "amp", "pi"];

export function getRankingNonCacheTokens(
  entry: Pick<RankingEntry, "nonCacheTokens" | "agentBreakdown" | "inputTokens" | "outputTokens" | "reasoningTokens">,
): number {
  if (entry.nonCacheTokens != null) return entry.nonCacheTokens;
  if (entry.agentBreakdown != null && entry.agentBreakdown.length > 0) {
    return entry.agentBreakdown.reduce((sum, agent) => sum + agent.nonCacheTokens, 0);
  }
  // Compatibility with responses cached by workers older than v0.6.10.
  return entry.inputTokens + entry.outputTokens + (entry.reasoningTokens || 0);
}

// Gentle invite nudge for solo groups: a leaderboard of one has no reason to
// stick around, and 77% of created groups never invite anyone. At most once
// a week, and only when the user is already looking at their empty board.
const INVITE_NUDGE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function getInviteNudgePath(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "invite-nudge");
}

function shouldNudgeInvite(): boolean {
  try {
    if (!existsSync(getInviteNudgePath())) return true;
    const last = parseInt(readFileSync(getInviteNudgePath(), "utf-8").trim(), 10);
    return !Number.isFinite(last) || Date.now() - last >= INVITE_NUDGE_INTERVAL_MS;
  } catch {
    return true;
  }
}

function markInviteNudged(): void {
  try { writeFileSync(getInviteNudgePath(), String(Date.now())); } catch { /* best effort */ }
}

/**
 * Window boundaries come back as UTC instants; slicing them as ISO strings
 * showed UTC dates, so "TODAY" looked like a two-day range for anyone east
 * of Greenwich. Render the viewer's local calendar dates instead, collapse
 * single-day windows, and omit the meaningless all-time bounds.
 */
export function formatLocalDateRange(startIso: string, endIso: string, period: RankingPeriod): string {
  if (period === "all-time") return "";
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const start = ymd(new Date(startIso));
  const end = ymd(new Date(new Date(endIso).getTime() - 1)); // end boundary is exclusive
  return start === end ? start : `${start} → ${end}`;
}

export interface RankCommandOptions {
  // Commander's optional-value flags (`-d [days]`) yield `true` when passed bare.
  days?: string | boolean;
  period?: string | boolean;
  group?: string;
  global?: boolean;
  cache?: boolean;
  all?: boolean;
  json?: boolean;
}

export async function rankCommand(options: RankCommandOptions): Promise<void> {
  const config = await requireConfig();
  const includeCache = options.cache !== false;

  // Ensure hook is installed (silent, one-time for existing users)
  if (!isHookInstalled()) await installHook();
  if (!isHeartbeatInstalled()) await installHeartbeat();

  // Only auto-sync when format version changed (one-time after CLI upgrade)
  // Regular syncing is handled by the session-end hook
  if (needsFullSync()) {
    await doSync(true, true);
  }

  // Resolve period from -d or -p flags
  let period: RankingPeriod = "daily";
  const DAYS_HINT = `\n  Usage:  ccclub -d <period>\n\n  Options:\n    ${theme.text("ccclub -d 1")}     Yesterday\n    ${theme.text("ccclub -d 7")}     Last 7 days\n    ${theme.text("ccclub -d 30")}    Last 30 days\n    ${theme.text("ccclub -d all")}   All time\n    ${theme.text("ccclub")}          Today (default)\n`;
  if (options.days) {
    if (options.days === true) {
      console.log(DAYS_HINT);
      return;
    }
    const DAYS_MAP: Record<string, RankingPeriod> = { "1": "yesterday", "7": "weekly", "30": "monthly", "all": "all-time" };
    const mapped = DAYS_MAP[options.days];
    if (!mapped) {
      console.log(theme.danger(`\n  Unknown value: -d ${options.days}`));
      console.log(DAYS_HINT);
      return;
    }
    period = mapped;
  } else if (options.period) {
    const validPeriods = ["daily", "yesterday", "weekly", "monthly", "all-time"];
    if (options.period === true || (typeof options.period === "string" && !validPeriods.includes(options.period))) {
      console.log(DAYS_HINT);
      return;
    }
    period = options.period as RankingPeriod;
  }

  const isGlobal = options.global === true;

  // Determine which groups to show
  let codes: string[];
  if (isGlobal) {
    codes = ["global"];
  } else if (options.group) {
    codes = [options.group];
  } else {
    codes = config.groups.length > 0 ? config.groups : [];
  }

  if (codes.length === 0) {
    console.log(theme.danger("No group found. Run 'ccclub init' or 'ccclub join <code>' first."));
    return;
  }

  // Fire in parallel with rank API — resolves by the time rank data arrives
  const localUsagePromise = fetchUsageLimits().catch(() => null);
  // One-time enable for users who set up ccclub before the statusline existed.
  // Skipped in JSON mode: machine consumers should never trigger installs.
  const statuslineEnabledPromise = options.json
    ? Promise.resolve(false)
    : maybeAutoEnableStatusline().catch(() => false);

  // Spinner only for interactive human use; never on pipes or JSON output.
  const spinner = options.json || !process.stdout.isTTY ? null : ora("Loading leaderboard...").start();

  try {
    // Fire all rank + activity fetches simultaneously across all groups
    const groupResults = await Promise.all(
      codes.map(async (code) => {
        const tz = -new Date().getTimezoneOffset();
        const range = period === "weekly" ? "7d" : period === "monthly" || period === "all-time" ? "30d" : period === "yesterday" ? "yesterday" : "24h";
        const [rankRes, activityRes] = await Promise.all([
          fetch(`${config.apiUrl}/api/rank/${code}?period=${period}&tz=${tz}`, { signal: AbortSignal.timeout(15_000) }),
          fetch(`${config.apiUrl}/api/activity/${code}?range=${range}&tz=${tz}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null),
        ]);
        if (!rankRes.ok) return { code, rankData: null, activityData: null, range };
        const rankData = (await rankRes.json()) as RankResponse;
        const activityData = activityRes?.ok ? ((await activityRes.json()) as ActivityResponse) : null;
        return { code, rankData, activityData, range };
      })
    );

    spinner?.stop();

    const localSnapshot = await localUsagePromise;

    // Fire-and-forget: upload own usage so others see fresh data
    if (localSnapshot) {
      fetch(`${config.apiUrl}/api/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ usageSnapshot: localSnapshot }),
        signal: AbortSignal.timeout(8_000),
      }).catch(() => {});
    }
    if (process.env.CCCLUB_DEBUG) {
      console.error("[usage-debug] localSnapshot:", localSnapshot);
      console.error("[usage-debug] config.userId:", config.userId);
    }

    // Machine-readable mode: raw server responses, nothing else on stdout.
    if (options.json) {
      const groups = groupResults
        .filter((result) => result.rankData != null)
        .map((result) => result.rankData);
      console.log(JSON.stringify({ period, groups }, null, 2));
      return;
    }

    for (let i = 0; i < groupResults.length; i++) {
      const { code, rankData, activityData, range } = groupResults[i];
      if (!rankData) {
        console.log(theme.danger(`\n  Couldn't load leaderboard for ${code}`));
        continue;
      }

      // Inject live local snapshot into current user's row (fresher than last sync)
      if (localSnapshot) {
        const me = rankData.rankings.find((r) => r.userId === config.userId);
        if (me) me.usageSnapshot = localSnapshot;
      }

      printGroup(rankData, code, period, config, includeCache, options.all);

      if (activityData) renderActivity(activityData, range);

      if (i < groupResults.length - 1) console.log("");

      // Freshly fetched today-rank for the primary group → update the
      // statusline cache for free.
      if (period === "daily" && code === config.groups[0]) {
        const me = rankData.rankings.find((r) => r.userId === config.userId);
        if (me) {
          await writeRankCache({
            rank: me.rank,
            total: rankData.rankings.length,
            costUSD: me.costUSD,
            url: `${config.apiUrl}/g/${encodeURIComponent(code)}`,
          });
        }
      }
    }

    if (includeCache) {
      console.log(theme.muted("\n  Tokens include cache by default. Use ") + theme.text("--no-cache") + theme.muted(" to show input + output + reasoning only."));
    } else {
      console.log(theme.muted("\n  Tokens = input + output + reasoning ") + theme.warning("(cache excluded)") + theme.muted(". Cost still includes cache."));
    }

    const update = await getUpdateResult();
    if (update) {
      console.log(theme.warningBold("\n  Update available") + theme.muted(`: ${update.current} → ${update.latest}  Run `) + theme.linkText("npm i -g ccclub@latest"));
    }

    if (await statuslineEnabledPromise) {
      console.log(theme.success("\n  ✓ Claude Code statusline enabled") + theme.muted(' — model · 5h/7d limits · rank. Run "') + theme.text("ccclub statusline off") + theme.muted('" to remove.'));
    }

    const soloGroup = isGlobal
      ? undefined
      : groupResults.find((result) => result.rankData != null && result.rankData.group.memberCount === 1);
    if (soloGroup?.rankData && shouldNudgeInvite()) {
      const code = soloGroup.rankData.group.code;
      console.log(theme.warning("\n  It's just you here") + theme.muted(" — a leaderboard needs rivals. See who burns more:"));
      console.log(theme.muted("    Share  ") + theme.link(`${config.apiUrl}/invite/${code}`) + theme.muted("   or send:  ") + theme.text(`npx ccclub join ${code}`));
      markInviteNudged();
    }
  } catch (err) {
    const message = `Error: ${formatFetchError(err)}`;
    if (spinner) spinner.fail(message);
    else console.error(message);
    process.exitCode = 1;
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) {
    const b = n / 1_000_000_000;
    return b % 1 === 0 ? `${b}B` : `${parseFloat(b.toFixed(1))}B`;
  }
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return m % 1 === 0 ? `${m}M` : `${parseFloat(m.toFixed(1))}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return k % 1 === 0 ? `${k}K` : `${parseFloat(k.toFixed(1))}K`;
  }
  return String(n);
}

function printGroup(data: RankResponse, code: string, period: RankingPeriod, config: { userId: string; apiUrl: string }, showCache = true, showAll = false): void {
  if (data.rankings.length === 0) {
    console.log(theme.title(`\n  ${data.group.name}`));
    console.log(theme.warning("  No data for this period yet"));
    console.log(theme.muted("  Sync your data first: ccclub sync"));
    return;
  }

  console.log(theme.title(`\n  ${data.group.name}`));
  const periodLabel: Record<string, string> = { daily: "TODAY", yesterday: "YESTERDAY", weekly: "7 DAYS", monthly: "30 DAYS", "all-time": "ALL TIME" };
  const now = Date.now();
  const activeEntries = data.rankings.filter((r) => isEntryActive(r, now));
  const activeCount = activeEntries.length;
  const range = formatLocalDateRange(data.start, data.end, period);
  console.log(theme.muted(`  ${periodLabel[period] || period.toUpperCase()}${range ? ` · ${range}` : ""} · ${data.group.memberCount} members`));
  if (activeCount > 0) {
    const activeSplit = formatActiveSourceSplit(activeEntries);
    console.log(theme.success(`  ${activeCount} active`) + (activeSplit ? ` ${activeSplit}` : ""));
  }
  console.log("");

  const activeRankings = showAll || data.rankings.length <= 15
    ? data.rankings
    : data.rankings.filter((r) => r.costUSD > 0 || r.userId === config.userId);
  const hiddenCount = data.rankings.length - activeRankings.length;

  const hasPlan = activeRankings.some((r) => r.plan);
  const hasAgents = activeRankings.some((r) =>
    r.agents && r.agents.length > 0 && !(r.agents.length === 1 && r.agents[0] === "claude")
  );

  const plainRows = activeRankings.map((entry) => {
    const isActive = isEntryActive(entry, now);
    const tokens = showCache ? entry.totalTokens : getRankingNonCacheTokens(entry);
    const roi = formatRoi(entry, hasPlan);
    return {
      entry,
      isActive,
      rank: `${entry.userId === config.userId ? "→" : " "}${entry.rank}`,
      name: `${isActive ? "● " : ""}${entry.displayName}`,
      agents: formatAgents(entry),
      cost: `$${entry.costUSD.toFixed(2)}`,
      tokens: formatTokens(tokens),
      roi,
      turns: String(entry.chatCount),
      perTurn: entry.chatCount > 0 ? `$${(entry.costUSD / entry.chatCount).toFixed(2)}` : "—",
    };
  });

  const head = ["#", "Name", "Cost", "Tokens"];
  const widths = [
    columnWidth("#", plainRows.map((r) => r.rank), 2, 3),
    columnWidth("Name", plainRows.map((r) => r.name), 10, 18),
    columnWidth("Cost", plainRows.map((r) => r.cost), 5, 9),
    columnWidth("Tokens", plainRows.map((r) => r.tokens), 6, 8),
  ];
  if (hasAgents) {
    head.splice(2, 0, "Agents");
    widths.splice(2, 0, columnWidth("Agents", plainRows.map((r) => r.agents), 6, 28));
  }
  if (hasPlan) {
    head.push("ROI");
    widths.push(columnWidth("ROI", plainRows.map((r) => r.roi), 3, 11));
  }
  head.push("Turns", "$/Turn");
  widths.push(
    columnWidth("Turns", plainRows.map((r) => r.turns), 3, 6),
    columnWidth("$/Turn", plainRows.map((r) => r.perTurn), 6, 7),
  );

  const table = new Table({
    head: head.map((h) => theme.linkText(h)),
    style: { head: [], border: ["gray"] },
    colWidths: widths,
  });

  for (const plain of plainRows) {
    const { entry } = plain;
    const isMe = entry.userId === config.userId;
    const rowStyle = isMe ? theme.success : podiumStyle(entry.rank);
    const nameStyle = isMe ? theme.successBold : podiumNameStyle(entry.rank);
    const rankStyle = podiumNameStyle(entry.rank);
    const marker = isMe ? theme.success("→") : " ";

    const nameWidth = Math.max(widths[1] - 2, 4);
    const displayName = plain.isActive
      ? `${theme.success("●")} ${nameStyle(truncateDisplay(entry.displayName, Math.max(nameWidth - 2, 1)))}`
      : nameStyle(truncateDisplay(entry.displayName, nameWidth));

    const row: string[] = [
      `${marker}${rankStyle(String(entry.rank))}`,
      displayName,
    ];

    if (hasAgents) {
      const agentWidth = Math.max(widths[2] - 2, 4);
      row.push(rowStyle(truncateDisplay(plain.agents, agentWidth)));
    }

    row.push(rowStyle(plain.cost), rowStyle(plain.tokens));

    if (hasPlan) {
      row.push(colorRoi(plain.roi, entry));
    }

    row.push(rowStyle(plain.turns));
    row.push(entry.chatCount > 0 ? rowStyle(plain.perTurn) : theme.faint("—"));

    table.push(row);
  }

  console.log(table.toString());
  if (hiddenCount > 0) {
    console.log(theme.muted(`  ${hiddenCount} inactive member${hiddenCount > 1 ? "s" : ""} hidden · ccclub --all to show`));
  }
  console.log(theme.muted("  Dashboard: ") + theme.link(`${config.apiUrl}/g/${code}`));
  if (code !== "global") {
    console.log(theme.muted("  Invite:    ") + theme.link(`${config.apiUrl}/invite/${code}`));
  }

  if (hasPlan) {
    const me = data.rankings.find((r) => r.userId === config.userId);
    if (me && !me.plan) {
      console.log(theme.muted("  Set your plan: ") + theme.text("ccclub profile --plan pro|max100|max200|api"));
    }
  }
}

function isEntryActive(entry: RankingEntry, now: number): boolean {
  const value = entry.lastActiveAt || entry.lastSync;
  if (!value) return false;
  const activeAt = new Date(value).getTime();
  return Number.isFinite(activeAt) && now - activeAt < ACTIVE_THRESHOLD_MS;
}

function activeSourceForEntry(entry: RankingEntry): AgentSource | undefined {
  return entry.lastActiveSource ?? entry.agents?.[0];
}

function formatActiveSourceSplit(entries: RankingEntry[]): string {
  const counts = new Map<AgentSource, number>();
  for (const entry of entries) {
    const source = activeSourceForEntry(entry);
    if (!source) continue;
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }

  const sources = AGENT_ORDER.filter((source) => (counts.get(source) ?? 0) > 0);
  if (sources.length === 0) return "";

  if (sources.length === 2 && sources.includes("claude") && sources.includes("codex")) {
    return [
      theme.muted("Claude"),
      theme.successBold(String(counts.get("claude") ?? 0)) + theme.faint(":"),
      theme.successBold(String(counts.get("codex") ?? 0)),
      theme.muted("Codex"),
    ].join(" ");
  }

  return sources.map((source) => formatActiveSourceScore(source, counts.get(source) ?? 0, false)).join(theme.faint(" · "));
}

function formatActiveSourceScore(source: AgentSource, count: number, countFirst: boolean): string {
  const icon = source === "claude" ? theme.gold("●") : source === "codex" ? theme.linkText("●") : theme.success("●");
  const label = source === "claude" ? "Claude" : formatAgentLabel(source);
  const coloredCount = theme.successBold(String(count));
  return countFirst
    ? `${coloredCount} ${icon} ${theme.muted(label)}`
    : `${icon} ${theme.muted(label)} ${coloredCount}`;
}

function podiumStyle(rank: number): StyleFn {
  if (rank === 1) return theme.gold;
  if (rank === 2) return theme.silver;
  if (rank === 3) return theme.bronze;
  return theme.text;
}

function podiumNameStyle(rank: number): StyleFn {
  if (rank === 1) return theme.goldBold;
  if (rank === 2) return theme.silverBold;
  if (rank === 3) return theme.bronzeBold;
  return theme.text;
}

function formatRoi(entry: RankingEntry, hasPlan: boolean): string {
  if (!hasPlan) return "";
  if (entry.plan && entry.plan !== "api") {
    const price = PLAN_PRICES[entry.plan as keyof typeof PLAN_PRICES];
    const monthly = entry.monthlyCostUSD || 0;
    const roi = price > 0 ? Math.round((monthly / price) * 100) : 0;
    return `$${price}/${roi}%`;
  }
  if (entry.plan === "api") return "API";
  return "—";
}

function colorRoi(roiStr: string, entry: RankingEntry): string {
  if (entry.plan && entry.plan !== "api") {
    const price = PLAN_PRICES[entry.plan as keyof typeof PLAN_PRICES];
    const monthly = entry.monthlyCostUSD || 0;
    const roi = price > 0 ? Math.round((monthly / price) * 100) : 0;
    return roi >= 100 ? theme.successBold(roiStr) : roi >= 50 ? theme.warning(roiStr) : theme.faint(roiStr);
  }
  return theme.faint(roiStr);
}

function formatAgents(entry: RankingEntry): string {
  if (entry.agentBreakdown && entry.agentBreakdown.length > 0) {
    if (entry.agentBreakdown.length === 1) {
      return formatAgentLabel(entry.agentBreakdown[0].source);
    }
    const visible = entry.agentBreakdown.slice(0, 2)
      .map((agent) => `${formatAgentLabel(agent.source)} (${agent.percent}%)`);
    if (entry.agentBreakdown.length > visible.length) {
      visible.push(`+${entry.agentBreakdown.length - visible.length}`);
    }
    return visible.join(", ");
  }

  if (!entry.agents || entry.agents.length === 0) return "—";
  return entry.agents.map(formatAgentLabel).join(", ");
}

function formatAgentLabel(agent: string): string {
  return AGENT_LABELS[agent as keyof typeof AGENT_LABELS] ?? agent;
}

function columnWidth(header: string, values: string[], minContent: number, maxContent: number): number {
  const contentWidth = Math.max(visualWidth(header), ...values.map(visualWidth));
  return Math.min(Math.max(contentWidth, minContent), maxContent) + 2;
}

function visualWidth(value: string): number {
  let width = 0;
  for (const char of value) width += charWidth(char);
  return width;
}

function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code === 0 || code < 32 || (code >= 0x7f && code < 0xa0)) return 0;
  if (
    code >= 0x1100 && (
      code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    )
  ) {
    return 2;
  }
  return 1;
}

function truncateDisplay(value: string, maxWidth: number): string {
  if (visualWidth(value) <= maxWidth) return value;
  if (maxWidth <= 1) return "…";

  let result = "";
  let width = 0;
  const limit = maxWidth - 1;
  for (const char of value) {
    const next = charWidth(char);
    if (width + next > limit) break;
    result += char;
    width += next;
  }
  return `${result}…`;
}

interface ActivityResponse {
  range: string;
  start: string;
  end: string;
  series: Array<{
    displayName: string;
    blocks: Array<{ t: string; cost: number }>;
  }>;
}

const SPARK_CHARS = "▁▂▃▄▅▆▇";

function renderActivity(data: ActivityResponse, range: string): void {
    const active = data.series.filter((s) => s.blocks.length > 0);
    if (active.length === 0) return;

    const startMs = new Date(data.start).getTime();
    const endMs = new Date(data.end).getTime();
    const bucketCount = range === "24h" || range === "yesterday" ? 48 : range === "7d" ? 28 : 30;
    const bucketMs = (endMs - startMs) / bucketCount;

    // Build all buckets with sqrt-compressed global normalization
    // Any non-zero activity shows at least ▂; ▁ = true zero baseline
    const allBuckets: number[][] = [];
    for (const user of active) {
      const buckets = new Array(bucketCount).fill(0) as number[];
      for (const bl of user.blocks) {
        const idx = Math.min(Math.floor((new Date(bl.t).getTime() - startMs) / bucketMs), bucketCount - 1);
        if (idx >= 0) buckets[idx] += bl.cost;
      }
      allBuckets.push(buckets);
    }

    let globalMax = 0;
    for (const buckets of allBuckets) {
      for (const v of buckets) { if (v > globalMax) globalMax = v; }
    }
    if (globalMax === 0) globalMax = 1;

    console.log(theme.muted(`\n  Activity (${range})`));

    for (let i = 0; i < active.length; i++) {
      const user = active[i];
      const buckets = allBuckets[i];
      const spark = buckets.map((v) => {
        if (v === 0) return SPARK_CHARS[0]; // ▁ for true zero
        // sqrt compression + minimum visible floor (▂)
        const normalized = Math.sqrt(v / globalMax);
        const idx = 1 + Math.min(Math.floor(normalized * (SPARK_CHARS.length - 1)), SPARK_CHARS.length - 2);
        return SPARK_CHARS[idx];
      }).join("");
      const total = user.blocks.reduce((s, b) => s + b.cost, 0);
      const maxWidth = 12;
      const name = truncateDisplay(user.displayName, maxWidth);
      const pad = " ".repeat(Math.max(0, maxWidth - visualWidth(name)));
      console.log(`  ${theme.muted(name + pad)} ${theme.brand(spark)}  ${theme.muted("$" + total.toFixed(2))}`);
    }

    // Time axis labels
    const axisArr: string[] = new Array(bucketCount).fill(" ");
    if (range === "24h" || range === "yesterday") {
      for (let b = 0; b < bucketCount; b += 12) {
        const t = new Date(startMs + b * bucketMs);
        const label = `${t.getHours()}h`;
        for (let c = 0; c < label.length && b + c < bucketCount; c++) axisArr[b + c] = label[c];
      }
    } else if (range === "7d") {
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      for (let b = 0; b < bucketCount; b += 4) {
        const t = new Date(startMs + b * bucketMs);
        const label = dayNames[t.getDay()];
        for (let c = 0; c < label.length && b + c < bucketCount; c++) axisArr[b + c] = label[c];
      }
    } else {
      for (let b = 0; b < bucketCount; b += 7) {
        const t = new Date(startMs + b * bucketMs);
        const label = `${t.getMonth() + 1}/${t.getDate()}`;
        for (let c = 0; c < label.length && b + c < bucketCount; c++) axisArr[b + c] = label[c];
      }
    }
    console.log(theme.faint("  " + " ".repeat(12) + " " + axisArr.join("")));
}
