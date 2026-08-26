import { UNRANKED_SOURCES, isRankedSource } from "@ccclub/shared";
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

  // A replace is scoped to the window this upload actually covers. Local logs
  // rotate (Claude Code keeps ~30 days by default), so a full sync after a
  // format bump only carries the recent window — an unscoped replace would
  // truncate a user's server-side history to whatever their disk still has,
  // every time. History older than the upload's earliest block survives.
  // A replace with NO incoming blocks for the source stays a full wipe: that
  // is the documented escape hatch for "this source's history was bogus".
  const replaceFromMs = new Map<AgentSource, number>();
  for (const block of incoming) {
    if (!isRankedSource(block.source)) continue;
    const source = block.source ?? "claude";
    if (!replace.has(source)) continue;
    const ms = new Date(block.blockStart).getTime();
    if (!Number.isFinite(ms)) continue;
    const earliest = replaceFromMs.get(source);
    if (earliest === undefined || ms < earliest) replaceFromMs.set(source, ms);
  }

  // Old blocks did not have source; treat those as Claude so pre-multi-agent
  // data remains compatible. Skip only sources explicitly replaced now, and
  // within a replaced source only blocks the upload's window supersedes.
  for (const block of existing) {
    const source = block.source ?? "claude";
    if (replace.has(source)) {
      const from = replaceFromMs.get(source);
      const ms = new Date(block.blockStart).getTime();
      const beforeWindow = from !== undefined && Number.isFinite(ms) && ms < from;
      if (!beforeWindow) continue;
    }
    blockMap.set(`${source}:${block.blockStart}`, block);
  }

  // Non-coding sources are dropped at storage time: older clients can still
  // upload them, but nothing they send may reach rankings. Opt-in coding
  // sources (Cursor) are ordinary blocks once a client chooses to send them.
  for (const block of incoming) {
    if (!isRankedSource(block.source)) continue;
    blockMap.set(`${block.source ?? "claude"}:${block.blockStart}`, block);
  }

  let merged = Array.from(blockMap.values()).sort(
    (a, b) => new Date(a.blockStart).getTime() - new Date(b.blockStart).getTime(),
  );

  // Restricted to UNRANKED sources so trackedSources can never prune a user's
  // coding history. NOT keyed off OPT_IN_SOURCES: opt-in only describes how
  // one machine collects, and a user who enabled Cursor on their laptop must
  // not lose that history the moment their desktop (where it is still off)
  // syncs. Old clients omit the field and nothing is pruned.
  if (options.trackedSources != null) {
    const tracked = new Set(options.trackedSources);
    const prune = new Set(UNRANKED_SOURCES.filter((source) => !tracked.has(source)));
    if (prune.size > 0) {
      merged = merged.filter((block) => !prune.has(block.source ?? "claude"));
    }
  }

  return merged;
}
