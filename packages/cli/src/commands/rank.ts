import chalk from "chalk";
import Table from "cli-table3";
import ora from "ora";
import type { RankingEntry, RankingPeriod, RankResponse } from "@ccclub/shared";
import { AGENT_LABELS, PLAN_PRICES } from "@ccclub/shared";
import { requireConfig } from "../config.js";
import { formatFetchError } from "../fetch-error.js";
import { doSync, needsFullSync } from "./sync.js";
import { installHook, isHookInstalled } from "../hook.js";
import { installHeartbeat, isHeartbeatInstalled } from "../heartbeat.js";
import { getUpdateResult } from "../update-check.js";
import { fetchUsageLimits } from "../usage-limits.js";

const ACTIVE_THRESHOLD_MS = 15 * 60 * 1000;

export async function rankCommand(options: { days?: string; period?: string; group?: string; global?: boolean; cache?: boolean; all?: boolean }): Promise<void> {
  const config = await requireConfig();

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
  const DAYS_HINT = `\n  Usage:  ccclub -d <period>\n\n  Options:\n    ${chalk.white("ccclub -d 1")}     Yesterday\n    ${chalk.white("ccclub -d 7")}     Last 7 days\n    ${chalk.white("ccclub -d 30")}    Last 30 days\n    ${chalk.white("ccclub -d all")}   All time\n    ${chalk.white("ccclub")}          Today (default)\n`;
  if (options.days) {
    if (options.days === true) {
      console.log(DAYS_HINT);
      return;
    }
    const DAYS_MAP: Record<string, RankingPeriod> = { "1": "yesterday", "7": "weekly", "30": "monthly", "all": "all-time" };
    const mapped = DAYS_MAP[options.days];
    if (!mapped) {
      console.log(chalk.red(`\n  Unknown value: -d ${options.days}`));
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
    console.log(chalk.red("No group found. Run 'ccclub init' or 'ccclub join <code>' first."));
    return;
  }

  // Fire in parallel with rank API — resolves by the time rank data arrives
  const localUsagePromise = fetchUsageLimits().catch(() => null);

  const spinner = ora("Loading leaderboard...").start();

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

    spinner.stop();

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

    for (let i = 0; i < groupResults.length; i++) {
      const { code, rankData, activityData, range } = groupResults[i];
      if (!rankData) {
        console.log(chalk.red(`\n  Couldn't load leaderboard for ${code}`));
        continue;
      }

      // Inject live local snapshot into current user's row (fresher than last sync)
      if (localSnapshot) {
        const me = rankData.rankings.find((r) => r.userId === config.userId);
        if (me) me.usageSnapshot = localSnapshot;
      }

      printGroup(rankData, code, period, config, options.cache, options.all);

      if (activityData) renderActivity(activityData, range);

      if (i < groupResults.length - 1) console.log("");
    }

    console.log(chalk.dim("\n  Tokens = input + output + reasoning ") + chalk.yellow("(cache excluded)") + chalk.dim(". Use ") + chalk.white("--cache") + chalk.dim(" to include cache tokens."));

    const update = await getUpdateResult();
    if (update) {
      console.log(chalk.yellow("\n  Update available") + chalk.dim(`: ${update.current} → ${update.latest}  Run `) + chalk.cyan("npm i -g ccclub@latest"));
    }
  } catch (err) {
    spinner.fail(`Error: ${formatFetchError(err)}`);
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

function printGroup(data: RankResponse, code: string, period: RankingPeriod, config: { userId: string; apiUrl: string }, showCache = false, showAll = false): void {
  if (data.rankings.length === 0) {
    console.log(chalk.bold(`\n  ${data.group.name}`));
    console.log(chalk.yellow("  No data for this period yet"));
    console.log(chalk.dim('  Sync your data first: ccclub sync'));
    return;
  }

  console.log(chalk.bold(`\n  ${data.group.name}`));
  const periodLabel: Record<string, string> = { daily: "TODAY", yesterday: "YESTERDAY", weekly: "7 DAYS", monthly: "30 DAYS", "all-time": "ALL TIME" };
  const now = Date.now();
  const activeCount = data.rankings.filter((r) => r.lastSync && now - new Date(r.lastSync).getTime() < ACTIVE_THRESHOLD_MS).length;
  console.log(chalk.dim(`  ${periodLabel[period] || period.toUpperCase()} · ${data.start.slice(0, 10)} → ${data.end.slice(0, 10)} · ${data.group.memberCount} members`));
  if (activeCount > 0) {
    console.log(chalk.green(`  ${activeCount} active`));
  }
  console.log("");

  const activeRankings = showAll || data.rankings.length <= 15
    ? data.rankings
    : data.rankings.filter((r) => r.costUSD > 0 || r.userId === config.userId);
  const hiddenCount = data.rankings.length - activeRankings.length;

  const hasPlan = activeRankings.some((r) => r.plan);
  const hasUsage = activeRankings.some((r) => r.usageSnapshot);
  const hasAgents = activeRankings.some((r) =>
    r.agents && r.agents.length > 0 && !(r.agents.length === 1 && r.agents[0] === "claude")
  );

  const plainRows = activeRankings.map((entry) => {
    const isActive = isEntryActive(entry, now);
    const tokens = showCache ? entry.totalTokens : entry.inputTokens + entry.outputTokens + (entry.reasoningTokens || 0);
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
      usage: entry.usageSnapshot ? `${Math.round(entry.usageSnapshot.sevenDay)}%` : "—",
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
    widths.splice(2, 0, columnWidth("Agents", plainRows.map((r) => r.agents), 6, 24));
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
  if (hasUsage) {
    head.push("Usage");
    widths.push(columnWidth("Usage", plainRows.map((r) => r.usage), 5, 6));
  }

  const table = new Table({
    head: head.map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
    colWidths: widths,
  });

  for (const plain of plainRows) {
    const { entry } = plain;
    const isMe = entry.userId === config.userId;
    const marker = isMe ? chalk.green("→") : " ";

    // Only two highlights: #1 gold, self green. Everything else default.
    const id = (s: string) => s;
    const c = isMe ? chalk.green : entry.rank === 1 ? chalk.yellow : id;
    const nameC = isMe ? chalk.green.bold : entry.rank === 1 ? chalk.yellow.bold : id;

    const nameWidth = Math.max(widths[1] - 2, 4);
    const displayName = plain.isActive
      ? `${chalk.green("●")} ${nameC(truncateDisplay(entry.displayName, Math.max(nameWidth - 2, 1)))}`
      : nameC(truncateDisplay(entry.displayName, nameWidth));

    const row: string[] = [
      `${marker}${c(String(entry.rank))}`,
      displayName,
    ];

    if (hasAgents) {
      const agentWidth = Math.max(widths[2] - 2, 4);
      row.push(c(truncateDisplay(plain.agents, agentWidth)));
    }

    row.push(c(plain.cost), c(plain.tokens));

    if (hasPlan) {
      row.push(colorRoi(plain.roi, entry));
    }

    row.push(c(plain.turns));
    row.push(entry.chatCount > 0 ? c(plain.perTurn) : chalk.dim("—"));

    if (hasUsage) {
      row.push(entry.usageSnapshot ? c(plain.usage) : chalk.dim("—"));
    }

    table.push(row);
  }

  console.log(table.toString());
  if (hiddenCount > 0) {
    console.log(chalk.dim(`  ${hiddenCount} inactive member${hiddenCount > 1 ? "s" : ""} hidden · ccclub --all to show`));
  }
  console.log(chalk.dim("  Dashboard: ") + chalk.green(`${config.apiUrl}/g/${code}`));
  if (code !== "global") {
    console.log(chalk.dim("  Invite:    ") + chalk.hex("#d4935e").underline(`${config.apiUrl}/invite/${code}`));
  }

  if (hasPlan) {
    const me = data.rankings.find((r) => r.userId === config.userId);
    if (me && !me.plan) {
      console.log(chalk.dim("  Set your plan: ") + chalk.white("ccclub profile --plan pro|max100|max200|api"));
    }
  }
}

function isEntryActive(entry: RankingEntry, now: number): boolean {
  return Boolean(entry.lastSync && now - new Date(entry.lastSync).getTime() < ACTIVE_THRESHOLD_MS);
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
    return roi >= 100 ? chalk.green.bold(roiStr) : roi >= 50 ? chalk.yellow(roiStr) : chalk.dim(roiStr);
  }
  return chalk.dim(roiStr);
}

function formatAgents(entry: RankingEntry): string {
  if (entry.agentBreakdown && entry.agentBreakdown.length > 0) {
    if (entry.agentBreakdown.length === 1) {
      return formatAgentLabel(entry.agentBreakdown[0].source);
    }
    const visible = entry.agentBreakdown.slice(0, 2)
      .map((agent) => `${formatAgentLabel(agent.source)} ${agent.percent}%`);
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

    console.log(chalk.dim(`\n  Activity (${range})`));

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
      const displayWidth = [...user.displayName].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x7f ? 2 : 1), 0);
      const maxWidth = 12;
      let name = user.displayName;
      if (displayWidth > maxWidth) {
        let w = 0;
        let cut = 0;
        for (const ch of name) {
          const cw = ch.charCodeAt(0) > 0x7f ? 2 : 1;
          if (w + cw > maxWidth) break;
          w += cw;
          cut++;
        }
        name = [...name].slice(0, cut).join("");
      }
      const pad = " ".repeat(Math.max(0, maxWidth - displayWidth));
      console.log(`  ${chalk.dim(name + pad)} ${spark}  ${chalk.dim("$" + total.toFixed(2))}`);
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
    console.log(chalk.dim("  " + " ".repeat(12) + " " + axisArr.join("")));
}
