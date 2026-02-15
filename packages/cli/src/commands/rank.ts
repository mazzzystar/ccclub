import chalk from "chalk";
import Table from "cli-table3";
import ora from "ora";
import type { RankingPeriod, RankResponse } from "@ccclub/shared";
import { PLAN_PRICES } from "@ccclub/shared";
import { requireConfig } from "../config.js";
import { doSync, needsFullSync } from "./sync.js";
import { installHook, isHookInstalled } from "../hook.js";
import { getUpdateResult } from "../update-check.js";

export async function rankCommand(options: { days?: string; period?: string; group?: string; global?: boolean; cache?: boolean }): Promise<void> {
  const config = await requireConfig();

  // Ensure hook is installed (silent, one-time for existing users)
  if (!isHookInstalled()) await installHook();

  // Only auto-sync when format version changed (one-time after CLI upgrade)
  // Regular syncing is handled by the session-end hook
  if (needsFullSync()) {
    await doSync(true, true);
  }

  // Resolve period from -d or -p flags
  let period: RankingPeriod = "daily";
  if (options.days) {
    const DAYS_MAP: Record<string, RankingPeriod> = { "7": "weekly", "30": "monthly", "all": "all-time" };
    const mapped = DAYS_MAP[options.days];
    if (!mapped) {
      console.log(chalk.red(`\n  Invalid value: -d ${options.days}`));
      console.log(chalk.dim("  Usage: ") + chalk.white("ccclub -d 7 | 30 | all"));
      return;
    }
    period = mapped;
  } else if (options.period) {
    const validPeriods = ["daily", "weekly", "monthly", "all-time"];
    if (options.period === true || (typeof options.period === "string" && !validPeriods.includes(options.period))) {
      const got = options.period === true ? "(missing)" : `"${options.period}"`;
      console.log(chalk.red(`\n  Invalid period: ${got}`));
      console.log(chalk.dim("  Usage: ") + chalk.white("ccclub -d 7 | 30 | all"));
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

  const spinner = ora("Fetching rankings...").start();

  try {
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      const tz = -new Date().getTimezoneOffset();
      const url = `${config.apiUrl}/api/rank/${code}?period=${period}&tz=${tz}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });

      if (!res.ok) {
        if (i === 0) spinner.stop();
        console.log(chalk.red(`\n  Failed to fetch rankings for ${code}`));
        continue;
      }

      const data = (await res.json()) as RankResponse;
      if (i === 0) spinner.stop();

      printGroup(data, code, period, config, options.cache);

      // Fetch and render activity sparklines
      const range = period === "weekly" ? "7d" : period === "monthly" || period === "all-time" ? "30d" : "24h";
      await printActivity(config.apiUrl, code, range);

      if (i < codes.length - 1) console.log("");
    }

    console.log(chalk.dim("\n  Tokens = input + output ") + chalk.yellow("(cache excluded)") + chalk.dim(". Use ") + chalk.white("--cache") + chalk.dim(" to include cache tokens."));

    const update = await getUpdateResult();
    if (update) {
      console.log(chalk.yellow("\n  Update available") + chalk.dim(`: ${update.current} → ${update.latest}  Run `) + chalk.cyan("npm i -g ccclub@latest"));
    }
  } catch (err) {
    spinner.fail(`Error: ${err instanceof Error ? err.message : err}`);
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

function printGroup(data: RankResponse, code: string, period: RankingPeriod, config: { userId: string; apiUrl: string }, showCache = false): void {
  if (data.rankings.length === 0) {
    console.log(chalk.bold(`\n  ${data.group.name}`));
    console.log(chalk.yellow("  No rankings data for this period"));
    console.log(chalk.dim('  Run "ccclub sync" to upload your usage data'));
    return;
  }

  console.log(chalk.bold(`\n  ${data.group.name}`));
  const periodLabel: Record<string, string> = { daily: "TODAY", weekly: "7 DAYS", monthly: "30 DAYS", "all-time": "ALL TIME" };
  console.log(chalk.dim(`  ${periodLabel[period] || period.toUpperCase()} · ${data.start.slice(0, 10)} → ${data.end.slice(0, 10)} · ${data.group.memberCount} members\n`));

  const hasPlan = data.rankings.some((r) => r.plan);

  const head = ["#", "Name", "Tokens", "Cost"];
  const widths = [5, 20, 10, 12];
  if (hasPlan) {
    head.push("Monthly ROI");
    widths.push(15);
  }
  head.push("Chats", "$/Chat");
  widths.push(8, 9);

  const table = new Table({
    head: head.map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
    colWidths: widths,
  });

  for (const entry of data.rankings) {
    const isMe = entry.userId === config.userId;
    const tokens = showCache ? entry.totalTokens : entry.inputTokens + entry.outputTokens;
    const marker = isMe ? chalk.green("→") : " ";

    // Only two highlights: #1 gold, self green. Everything else default.
    const id = (s: string) => s;
    const c = isMe ? chalk.green : entry.rank === 1 ? chalk.yellow : id;
    const nameC = isMe ? chalk.green.bold : entry.rank === 1 ? chalk.yellow.bold : id;

    const row: string[] = [
      `${marker}${c(String(entry.rank))}`,
      nameC(entry.displayName),
      c(formatTokens(tokens)),
      c(`$${entry.costUSD.toFixed(2)}`),
    ];

    if (hasPlan) {
      if (entry.plan && entry.plan !== "api") {
        const price = PLAN_PRICES[entry.plan as keyof typeof PLAN_PRICES];
        const monthly = entry.monthlyCostUSD || 0;
        const roi = price > 0 ? Math.round((monthly / price) * 100) : 0;
        const roiStr = `$${price}/${roi}%`;
        const roiC = roi >= 100 ? chalk.green.bold(roiStr) : roi >= 50 ? chalk.yellow(roiStr) : chalk.dim(roiStr);
        row.push(roiC);
      } else if (entry.plan === "api") {
        row.push(chalk.dim("API"));
      } else {
        row.push(chalk.dim("—"));
      }
    }

    row.push(c(String(entry.chatCount)));
    row.push(entry.chatCount > 0 ? c(`$${(entry.costUSD / entry.chatCount).toFixed(2)}`) : chalk.dim("—"));
    table.push(row);
  }

  console.log(table.toString());
  console.log(chalk.dim(`  Dashboard: ${config.apiUrl}/g/${code}`));

  // Hint if the group has plan users but current user hasn't set one
  if (hasPlan) {
    const me = data.rankings.find((r) => r.userId === config.userId);
    if (me && !me.plan) {
      console.log(chalk.dim("  Set your plan: ") + chalk.white("ccclub profile --plan pro|max100|max200|api"));
    }
  }
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

async function printActivity(apiUrl: string, code: string, range: string): Promise<void> {
  try {
    const tz = -new Date().getTimezoneOffset();
    const res = await fetch(`${apiUrl}/api/activity/${code}?range=${range}&tz=${tz}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return;

    const data = (await res.json()) as ActivityResponse;
    const active = data.series.filter((s) => s.blocks.length > 0);
    if (active.length === 0) return;

    const startMs = new Date(data.start).getTime();
    const endMs = new Date(data.end).getTime();
    const bucketCount = range === "24h" ? 48 : range === "7d" ? 28 : 30;
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
    if (range === "24h") {
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
  } catch {
    // Silently skip if activity fetch fails
  }
}
