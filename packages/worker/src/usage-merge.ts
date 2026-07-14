import { OPT_IN_SOURCES, isRankedSource } from "@ccclub/shared";
import type { AgentSource, UsageBlock } from "@ccclub/shared";

interface MergeUsageOptions {
  replaceSources?: AgentSource[];
  trackedSources?: AgentSource[];
}

/**
 * Merge an authenticated user's usage upload into their existing history.
 * A full sync can replace selected sources atomically so obsolete blocks do
 * not survive parser fixes; ordinary incremental uploads retain merge-only
 * behavior for backward compatibility.
 */
export function mergeUsageBlocks(
  existing: UsageBlock[],
  incoming: UsageBlock[],
  options: MergeUsageOptions = {},
): UsageBlock[] {
  const replace = new Set(options.replaceSources ?? []);
  const blockMap = new Map<string, UsageBlock>();

  // Old blocks did not have source; treat those as Claude so pre-multi-agent
  // data remains compatible. Skip only sources explicitly replaced now.
  for (const block of existing) {
    const source = block.source ?? "claude";
    if (replace.has(source)) continue;
    blockMap.set(`${source}:${block.blockStart}`, block);
  }

  // Non-coding (opt-in) sources are dropped at storage time: older clients
  // can still upload them, but nothing they send may reach rankings.
  for (const block of incoming) {
    if (!isRankedSource(block.source)) continue;
    blockMap.set(`${block.source ?? "claude"}:${block.blockStart}`, block);
  }

  let merged = Array.from(blockMap.values()).sort(
    (a, b) => new Date(a.blockStart).getTime() - new Date(b.blockStart).getTime(),
  );

  // Restricted to opt-in sources so trackedSources can never prune a user's
  // coding history. Old clients omit the field and nothing is pruned.
  if (options.trackedSources != null) {
    const tracked = new Set(options.trackedSources);
    const prune = new Set(OPT_IN_SOURCES.filter((source) => !tracked.has(source)));
    if (prune.size > 0) {
      merged = merged.filter((block) => !prune.has(block.source ?? "claude"));
    }
  }

  return merged;
}
