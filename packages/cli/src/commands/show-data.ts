import chalk from "chalk";
import { collectUsageEntries } from "../collector.js";
import { aggregateToBlocks } from "../aggregator.js";

export async function showDataCommand(): Promise<void> {
  console.log(chalk.bold("\n  What CCClub uploads:\n"));
  console.log(chalk.dim("  Only aggregated 5-hour block summaries. No conversation content,"));
  console.log(chalk.dim("  no file paths, no project names, no session details.\n"));

  const { entries, humanTurns } = await collectUsageEntries();
  const blocks = aggregateToBlocks(entries, humanTurns);

  if (blocks.length === 0) {
    console.log(chalk.yellow("  No usage data found in ~/.claude/projects/"));
    return;
  }

  console.log(chalk.dim(`  Total entries found: ${entries.length}`));
  console.log(chalk.dim(`  Aggregated into: ${blocks.length} blocks\n`));

  // Show last 5 blocks as example
  const recent = blocks.slice(-5);
  console.log(chalk.bold("  Last 5 blocks (this is exactly what gets uploaded):\n"));

  for (const block of recent) {
    console.log(chalk.cyan(`  ${block.blockStart.slice(0, 16)} → ${block.blockEnd.slice(11, 16)}`));
    console.log(chalk.dim(`    tokens: ${block.totalTokens.toLocaleString()}  cost: $${block.costUSD.toFixed(4)}  calls: ${block.entryCount}  models: ${block.models.join(", ")}`));
  }

  const totalTokens = blocks.reduce((s, b) => s + b.totalTokens, 0);
  const totalCost = blocks.reduce((s, b) => s + b.costUSD, 0);
  console.log(chalk.bold(`\n  All-time total: ${totalTokens.toLocaleString()} tokens · $${totalCost.toFixed(2)}`));
}
