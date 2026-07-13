import chalk from "chalk";
import { AGENT_LABELS } from "@ccclub/shared";
import { collectUsageEntries } from "../collector.js";
import { aggregateToBlocks } from "../aggregator.js";
import { loadPricing } from "../pricing.js";
import { createScanCacheFactory } from "../scan-cache.js";
import { parseSources, resolveTrackedSources } from "../sources/index.js";
import { loadConfig } from "../config.js";

export async function showDataCommand(): Promise<void> {
  console.log(chalk.bold("\n  What ccclub uploads:\n"));
  console.log(chalk.dim("  Only aggregated 30-minute block summaries. No conversation content,"));
  console.log(chalk.dim("  no file paths, no project names, no session details.\n"));

  const config = await loadConfig();
  const { calculateCost, version } = await loadPricing();
  const { entries, humanTurns, sources, warnings } = await collectUsageEntries({
    // Mirror exactly what sync would upload: defaults + opted-in sources.
    sources: process.env.CCCLUB_SOURCES?.trim()
      ? parseSources(process.env.CCCLUB_SOURCES)
      : resolveTrackedSources(config?.extraSources),
    calculateCost,
    pricingVersion: version,
    openScanCache: createScanCacheFactory(),
  });
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
    console.log(chalk.dim(`    input: ${block.inputTokens.toLocaleString()}  output: ${block.outputTokens.toLocaleString()}  cache_create: ${block.cacheCreationTokens.toLocaleString()}  cache_read: ${block.cacheReadTokens.toLocaleString()}`));
    if (block.reasoningTokens) {
      console.log(chalk.dim(`    reasoning: ${block.reasoningTokens.toLocaleString()}`));
    }
    console.log(chalk.dim(`    cost: $${block.costUSD.toFixed(4)}  calls: ${block.entryCount}  turns: ${block.chatCount || 0}  models: ${block.models.join(", ")}`));
  }

  const totalInput = blocks.reduce((s, b) => s + b.inputTokens, 0);
  const totalOutput = blocks.reduce((s, b) => s + b.outputTokens, 0);
  const totalReasoning = blocks.reduce((s, b) => s + (b.reasoningTokens || 0), 0);
  const totalCache = blocks.reduce((s, b) => s + b.cacheCreationTokens + b.cacheReadTokens, 0);
  const totalCost = blocks.reduce((s, b) => s + b.costUSD, 0);
  console.log(chalk.bold(`\n  All-time total: ${(totalInput + totalOutput + totalReasoning).toLocaleString()} non-cache tokens · $${totalCost.toFixed(2)}`));
  console.log(chalk.dim(`    input: ${totalInput.toLocaleString()}  output: ${totalOutput.toLocaleString()}  reasoning: ${totalReasoning.toLocaleString()}  cache: ${totalCache.toLocaleString()}`));
}
