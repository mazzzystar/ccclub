import { BLOCK_DURATION_MS, calculateCost } from "@ccclub/shared";
import type { UsageEntry, UsageBlock } from "@ccclub/shared";

function floorToHour(date: Date): Date {
  const floored = new Date(date);
  floored.setUTCMinutes(0, 0, 0);
  return floored;
}

export function aggregateToBlocks(entries: UsageEntry[]): UsageBlock[] {
  if (entries.length === 0) return [];

  const blocks: UsageBlock[] = [];
  let blockStart = floorToHour(new Date(entries[0].timestamp));
  let blockEnd = new Date(blockStart.getTime() + BLOCK_DURATION_MS);
  let currentBlock: UsageEntry[] = [];

  function flushBlock() {
    if (currentBlock.length === 0) return;

    const models = new Set<string>();
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    let totalTokens = 0;
    let costUSD = 0;

    for (const entry of currentBlock) {
      inputTokens += entry.inputTokens;
      outputTokens += entry.outputTokens;
      cacheCreationTokens += entry.cacheCreationTokens;
      cacheReadTokens += entry.cacheReadTokens;
      totalTokens += entry.totalTokens;
      models.add(entry.model);

      if (entry.costUSD > 0) {
        costUSD += entry.costUSD;
      } else {
        costUSD += calculateCost(
          entry.model,
          entry.inputTokens,
          entry.outputTokens,
          entry.cacheCreationTokens,
          entry.cacheReadTokens,
        );
      }
    }

    blocks.push({
      blockStart: blockStart.toISOString(),
      blockEnd: blockEnd.toISOString(),
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      totalTokens,
      costUSD: Math.round(costUSD * 10000) / 10000,
      models: Array.from(models),
      entryCount: currentBlock.length,
    });
  }

  for (const entry of entries) {
    const entryTime = new Date(entry.timestamp);

    while (entryTime >= blockEnd) {
      flushBlock();
      currentBlock = [];
      blockStart = new Date(blockEnd);
      blockEnd = new Date(blockStart.getTime() + BLOCK_DURATION_MS);
    }

    currentBlock.push(entry);
  }

  flushBlock();
  return blocks;
}
