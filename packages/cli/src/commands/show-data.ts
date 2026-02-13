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
    console.log(chalk.dim(`    input: ${block.inputTokens.toLocaleString()}  output: ${block.outputTokens.toLocaleString()}  cache_create: ${block.cacheCreationTokens.toLocaleString()}  cache_read: ${block.cacheReadTokens.toLocaleString()}`));
    console.log(chalk.dim(`    cost: $${block.costUSD.toFixed(4)}  calls: ${block.entryCount}  models: ${block.models.join(", ")}`));
  }

  const totalInput = blocks.reduce((s, b) => s + b.inputTokens, 0);
  const totalOutput = blocks.reduce((s, b) => s + b.outputTokens, 0);
  const totalCacheCreation = blocks.reduce((s, b) => s + b.cacheCreationTokens, 0);
  const totalCacheRead = blocks.reduce((s, b) => s + b.cacheReadTokens, 0);
  const totalCost = blocks.reduce((s, b) => s + b.costUSD, 0);
  console.log(chalk.bold(`\n  All-time total: $${totalCost.toFixed(2)}`));
  console.log(chalk.dim(`    input: ${totalInput.toLocaleString()}  output: ${totalOutput.toLocaleString()}`));
  console.log(chalk.dim(`    cache_create: ${totalCacheCreation.toLocaleString()}  cache_read: ${totalCacheRead.toLocaleString()}`));
}
