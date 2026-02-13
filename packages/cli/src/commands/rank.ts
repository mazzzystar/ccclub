import chalk from "chalk";
import Table from "cli-table3";
import ora from "ora";
import type { RankingPeriod, RankResponse } from "@ccclub/shared";
import { requireConfig } from "../config.js";
import { doSync } from "./sync.js";

export async function rankCommand(options: { period?: string; group?: string; global?: boolean }): Promise<void> {
  const config = await requireConfig();

  // Quick sync before showing rankings
  await doSync(false, true);

  const isGlobal = options.global === true;
  const period = (options.period || "daily") as RankingPeriod;

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
      const res = await fetch(url);

      if (!res.ok) {
        if (i === 0) spinner.stop();
        console.log(chalk.red(`\n  Failed to fetch rankings for ${code}`));
        continue;
      }

      const data = (await res.json()) as RankResponse;
      if (i === 0) spinner.stop();

      printGroup(data, code, period, config);

      if (i < codes.length - 1) console.log("");
    }

    console.log(chalk.dim("\n  Data syncs automatically when each Claude Code session ends."));
  } catch (err) {
    spinner.fail(`Error: ${err instanceof Error ? err.message : err}`);
  }
}

function printGroup(data: RankResponse, code: string, period: RankingPeriod, config: { userId: string; apiUrl: string }): void {
  if (data.rankings.length === 0) {
    console.log(chalk.bold(`\n  ${data.group.name}`));
    console.log(chalk.yellow("  No rankings data for this period"));
    console.log(chalk.dim('  Run "ccclub sync" to upload your usage data'));
    return;
  }

  console.log(chalk.bold(`\n  ${data.group.name}`));
  console.log(chalk.dim(`  ${period.toUpperCase()} · ${data.start.slice(0, 10)} → ${data.end.slice(0, 10)} · ${data.group.memberCount} members\n`));

  const table = new Table({
    head: ["#", "Name", "Tokens", "Cost", "Chats"].map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
    colWidths: [5, 20, 16, 12, 8],
  });

  for (const entry of data.rankings) {
    const isMe = entry.userId === config.userId;
    const marker = isMe ? chalk.green("→") : " ";
    const name = isMe ? chalk.green.bold(entry.displayName) : entry.displayName;
    const rankColor = entry.rank <= 3 ? chalk.yellow : chalk.white;

    table.push([
      `${marker}${rankColor(String(entry.rank))}`,
      name,
      entry.totalTokens.toLocaleString(),
      `$${entry.costUSD.toFixed(2)}`,
      String(entry.chatCount),
    ]);
  }

  console.log(table.toString());
  console.log(chalk.dim(`  Dashboard: ${config.apiUrl}/g/${code}`));
}
