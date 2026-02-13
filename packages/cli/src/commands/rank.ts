import chalk from "chalk";
import Table from "cli-table3";
import ora from "ora";
import type { RankingPeriod, RankResponse } from "@ccclub/shared";
import { requireConfig } from "../config.js";

export async function rankCommand(options: { period?: string; group?: string; global?: boolean }): Promise<void> {
  const config = await requireConfig();
  const spinner = ora("Fetching rankings...").start();

  const isGlobal = options.global === true;

  // Use first group if no group specified (unless global)
  const groupCode = isGlobal ? "global" : (options.group || config.groups[0]);
  if (!groupCode) {
    spinner.fail("No group found. Run 'ccclub init' or 'ccclub join <code>' first.");
    return;
  }

  const period = (options.period || "daily") as RankingPeriod;
  const url = `${config.apiUrl}/api/rank/${groupCode}?period=${period}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      spinner.fail("Failed to fetch rankings");
      return;
    }

    const data = (await res.json()) as RankResponse;
    spinner.stop();

    if (data.rankings.length === 0) {
      console.log(chalk.yellow("\n  No rankings data for this period"));
      console.log(chalk.dim('  Run "ccclub sync" to upload your usage data'));
      return;
    }

    console.log(chalk.bold(`\n  ${data.group.name}`));
    console.log(chalk.dim(`  ${period.toUpperCase()} · ${data.start.slice(0, 10)} → ${data.end.slice(0, 10)} · ${data.group.memberCount} members\n`));

    const table = new Table({
      head: ["#", "Name", "Tokens", "Cost", "Calls"].map((h) => chalk.cyan(h)),
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
        String(entry.entryCount),
      ]);
    }

    console.log(table.toString());
    console.log(chalk.dim(`\n  Dashboard: ${config.apiUrl}/g/${groupCode}`));
  } catch (err) {
    spinner.fail(`Error: ${err instanceof Error ? err.message : err}`);
  }
}
