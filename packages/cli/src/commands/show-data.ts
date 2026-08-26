import chalk from "chalk";
import { AGENT_LABELS, getNonCacheTokens } from "@ccclub/shared";
import { collectUsageEntries } from "../collector.js";
import { aggregateToBlocks } from "../aggregator.js";
import { loadConfig } from "../config.js";
import { loadPricing } from "../pricing.js";
import { resolveCollectSources } from "../sources/index.js";
import { createScanCacheFactory } from "../scan-cache.js";
import { acquireSyncLock } from "../sync-lock.js";

export async function showDataCommand(): Promise<void> {
  console.log(chalk.bold("\n  What ccclub uploads:\n"));
  console.log(chalk.dim("  Only aggregated 30-minute block summaries. No conversation content,"));
  console.log(chalk.dim("  no file paths, no project names, no session details.\n"));

  const lock = await acquireSyncLock();
  if (lock == null) {
    console.log(chalk.yellow("  A sync is already scanning local data. Try again in a moment."));
    return;
  }

  let collection: Awaited<ReturnType<typeof collectUsageEntries>>;
  try {
    const { calculateCost } = await loadPricing();
    // Same source list sync would use, so this preview is the real payload.
    const config = await loadConfig();
    collection = await collectUsageEntries({
      sources: resolveCollectSources(config),
      calculateCost,
      openScanCache: createScanCacheFactory(),
    });
  } finally {
    await lock.release();
  }
  const { entries, humanTurns, sources, warnings } = collection;
  const blocks = aggregateToBlocks(entries, humanTurns);

  if (blocks.length === 0) {
    console.log(chalk.yellow("  No usage data found for supported coding agents."));
    for (const warning of warnings) console.log(chalk.dim(`  ${warning}`));
    return;
  }

  console.log(chalk.dim(`  Total entries found: ${entries.length}`));
  console.log(chalk.dim(`  Aggregated into: ${blocks.length} blocks\n`));
  console.log(chalk.bold("  Sources:\n"));
  for (const source of sources.filter((s) => s.entries.length > 0)) {
    console.log(chalk.dim(`    ${AGENT_LABELS[source.source]}: ${source.entries.length.toLocaleString()} entries from ${source.files.toLocaleString()} files/records`));
  }
  console.log("");

  // Show last 5 blocks as example
  const recent = blocks.slice(-5);
  console.log(chalk.bold("  Last 5 blocks (this is exactly what gets uploaded):\n"));

  for (const block of recent) {
    console.log(chalk.cyan(`  ${AGENT_LABELS[block.source ?? "claude"]} · ${block.blockStart.slice(0, 16)} → ${block.blockEnd.slice(11, 16)}`));
    console.log(chalk.dim(`    input: ${block.inputTokens.toLocaleString()}  output: ${block.outputTokens.toLocaleString()}  cache_create: ${block.cacheCreationTokens.toLocaleString()}  cache_create_1h: ${(block.cacheCreation1hTokens || 0).toLocaleString()}  cache_read: ${block.cacheReadTokens.toLocaleString()}`));
    if (block.reasoningTokens) {
      console.log(chalk.dim(`    reasoning: ${block.reasoningTokens.toLocaleString()}`));
    }
    console.log(chalk.dim(`    cost: $${block.costUSD.toFixed(4)}  calls: ${block.entryCount}  turns: ${block.chatCount || 0}  models: ${block.models.join(", ")}`));
  }

  const totalInput = blocks.reduce((s, b) => s + b.inputTokens, 0);
  const totalOutput = blocks.reduce((s, b) => s + b.outputTokens, 0);
  const totalReasoning = blocks.reduce((s, b) => s + (b.reasoningTokens || 0), 0);
  const totalNonCache = blocks.reduce((s, b) => s + getNonCacheTokens(b), 0);
  const totalCache = blocks.reduce((s, b) => s + b.cacheCreationTokens + b.cacheReadTokens, 0);
  const totalCost = blocks.reduce((s, b) => s + b.costUSD, 0);
  console.log(chalk.bold(`\n  All-time total: ${totalNonCache.toLocaleString()} non-cache tokens · $${totalCost.toFixed(2)}`));
  console.log(chalk.dim(`    input: ${totalInput.toLocaleString()}  output: ${totalOutput.toLocaleString()}  reasoning: ${totalReasoning.toLocaleString()}  cache: ${totalCache.toLocaleString()}`));
}
