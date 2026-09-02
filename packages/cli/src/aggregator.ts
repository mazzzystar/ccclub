import { BLOCK_DURATION_MS } from "@ccclub/shared";
import type { AgentSource, UsageEntry, UsageBlock } from "@ccclub/shared";
import { byTimestamp } from "./sources/shared.js";
import type { UsageTurn } from "./sources/index.js";

// Block bounds are carried as epoch milliseconds, not Dates. Every entry has
// to be placed against them, and building two Dates per entry to do it cost
// 640k allocations on a 320k-entry corpus for a number each comparison
// already had.
function floorToBlockMs(ms: number): number {
  const floored = new Date(ms);
  const min = floored.getUTCMinutes();
  floored.setUTCMinutes(min - (min % 30), 0, 0);
  return floored.getTime();
}

function aggregateSourceToBlocks(source: AgentSource, entries: UsageEntry[], humanTurns: UsageTurn[]): UsageBlock[] {
  if (entries.length === 0) return [];

  // Pre-convert human turn timestamps to ms for fast lookup
  const humanTurnMs = humanTurns.map((t) => Date.parse(t.timestamp));

  const blocks: UsageBlock[] = [];
  let blockStartMs = floorToBlockMs(Date.parse(entries[0].timestamp));
  let blockEndMs = blockStartMs + BLOCK_DURATION_MS;
  let currentBlock: UsageEntry[] = [];
  let lastActivityMs = 0;
  let humanIdx = 0;

  function countHumanTurns(): number {
    let count = 0;
    // Advance past any turns before this block
    while (humanIdx < humanTurnMs.length && humanTurnMs[humanIdx] < blockStartMs) humanIdx++;
    // Count turns within this block
    let i = humanIdx;
    while (i < humanTurnMs.length && humanTurnMs[i] < blockEndMs) { count++; i++; }
    return count;
  }

  function flushBlock() {
    if (currentBlock.length === 0) return;

    const models = new Set<string>();
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheCreation1hTokens = 0;
    let cacheReadTokens = 0;
    let reasoningTokens = 0;
    let totalTokens = 0;
    let costUSD = 0;

    for (const entry of currentBlock) {
      inputTokens += entry.inputTokens;
      outputTokens += entry.outputTokens;
      cacheCreationTokens += entry.cacheCreationTokens;
      cacheCreation1hTokens += entry.cacheCreation1hTokens || 0;
      cacheReadTokens += entry.cacheReadTokens;
      reasoningTokens += entry.reasoningTokens || 0;
      totalTokens += entry.totalTokens;
      models.add(entry.model);

      // Cost is computed exactly once, by the collector that parsed the entry.
      costUSD += entry.costUSD;
    }

    blocks.push({
      source,
      blockStart: new Date(blockStartMs).toISOString(),
      blockEnd: new Date(blockEndMs).toISOString(),
      lastActivityAt: new Date(lastActivityMs || blockEndMs).toISOString(),
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheCreation1hTokens,
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
    const entryMs = Date.parse(entry.timestamp);

    while (entryMs >= blockEndMs) {
      flushBlock();
      currentBlock = [];
      lastActivityMs = 0;
      blockStartMs = blockEndMs;
      blockEndMs = blockStartMs + BLOCK_DURATION_MS;
    }

    currentBlock.push(entry);
    // Entries arrive sorted, but an unparsable timestamp is NaN and loses
    // every comparison — which is exactly what the old finite check did.
    if (entryMs > lastActivityMs) lastActivityMs = entryMs;
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
        sourceEntries.sort(byTimestamp),
        turnsBySource.get(source) ?? [],
      ),
    );
  }

  return blocks.sort((a, b) =>
    (a.blockStart < b.blockStart ? -1 : a.blockStart > b.blockStart ? 1 : 0) ||
    (a.source ?? "claude").localeCompare(b.source ?? "claude")
  );
}
