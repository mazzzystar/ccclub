import { BLOCK_DURATION_MS, calculateCost } from "@ccclub/shared";
import type { AgentSource, UsageEntry, UsageBlock } from "@ccclub/shared";
import type { UsageTurn } from "./sources/index.js";

function floorToBlock(date: Date): Date {
  const floored = new Date(date);
  const min = floored.getUTCMinutes();
  floored.setUTCMinutes(min - (min % 30), 0, 0);
  return floored;
}

function aggregateSourceToBlocks(source: AgentSource, entries: UsageEntry[], humanTurns: UsageTurn[]): UsageBlock[] {
  if (entries.length === 0) return [];

  // Pre-convert human turn timestamps to ms for fast lookup
  const humanTurnMs = humanTurns.map((t) => new Date(t.timestamp).getTime());

  const blocks: UsageBlock[] = [];
  let blockStart = floorToBlock(new Date(entries[0].timestamp));
  let blockEnd = new Date(blockStart.getTime() + BLOCK_DURATION_MS);
  let currentBlock: UsageEntry[] = [];
  let humanIdx = 0;

  function countHumanTurns(): number {
    const startMs = blockStart.getTime();
    const endMs = blockEnd.getTime();
    let count = 0;
    // Advance past any turns before this block
    while (humanIdx < humanTurnMs.length && humanTurnMs[humanIdx] < startMs) humanIdx++;
    // Count turns within this block
    let i = humanIdx;
    while (i < humanTurnMs.length && humanTurnMs[i] < endMs) { count++; i++; }
    return count;
  }

  function flushBlock() {
    if (currentBlock.length === 0) return;

    const models = new Set<string>();
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    let reasoningTokens = 0;
    let totalTokens = 0;
    let costUSD = 0;
    let lastActivityMs = 0;

    for (const entry of currentBlock) {
      inputTokens += entry.inputTokens;
      outputTokens += entry.outputTokens;
      cacheCreationTokens += entry.cacheCreationTokens;
      cacheReadTokens += entry.cacheReadTokens;
      reasoningTokens += entry.reasoningTokens || 0;
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
          entry.reasoningTokens || 0,
        );
      }
      const entryMs = new Date(entry.timestamp).getTime();
      if (Number.isFinite(entryMs) && entryMs > lastActivityMs) lastActivityMs = entryMs;
    }

    blocks.push({
      source,
      blockStart: blockStart.toISOString(),
      blockEnd: blockEnd.toISOString(),
      lastActivityAt: new Date(lastActivityMs || blockEnd.getTime()).toISOString(),
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      reasoningTokens,
      totalTokens,
      costUSD: Math.round(costUSD * 10000) / 10000,
      models: Array.from(models),
      entryCount: currentBlock.length,
      chatCount: countHumanTurns(),
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

export function aggregateToBlocks(entries: UsageEntry[], humanTurns: UsageTurn[] = []): UsageBlock[] {
  if (entries.length === 0) return [];

  const entriesBySource = new Map<AgentSource, UsageEntry[]>();
  for (const entry of entries) {
    const group = entriesBySource.get(entry.source) ?? [];
    group.push(entry);
    entriesBySource.set(entry.source, group);
  }

  const turnsBySource = new Map<AgentSource, UsageTurn[]>();
  for (const turn of humanTurns) {
    const group = turnsBySource.get(turn.source) ?? [];
    group.push(turn);
    turnsBySource.set(turn.source, group);
  }

  const blocks: UsageBlock[] = [];

  for (const [source, sourceEntries] of entriesBySource) {
    blocks.push(
      ...aggregateSourceToBlocks(
        source,
        sourceEntries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
        turnsBySource.get(source) ?? [],
      ),
    );
  }

  return blocks.sort((a, b) =>
    new Date(a.blockStart).getTime() - new Date(b.blockStart).getTime() ||
    (a.source ?? "claude").localeCompare(b.source ?? "claude")
  );
}
