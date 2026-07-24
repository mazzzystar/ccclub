import { describe, expect, it } from "vitest";
import type { AgentSource, UsageBlock } from "@ccclub/shared";
import { mergeUsageBlocks } from "./usage-merge.js";

function block(source: AgentSource | undefined, blockStart: string, totalTokens: number): UsageBlock {
  return {
    source,
    blockStart,
    blockEnd: new Date(new Date(blockStart).getTime() + 30 * 60 * 1000).toISOString(),
    totalTokens,
    costUSD: 0,
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    models: [],
    entryCount: 1,
  };
}

describe("mergeUsageBlocks", () => {
  it("removes stale blocks only for a source replaced by a full sync", () => {
    const existing = [
      block("codex", "2026-07-08T00:00:00.000Z", 100),
      block("codex", "2026-07-08T00:30:00.000Z", 200),
      block("claude", "2026-07-08T00:00:00.000Z", 300),
    ];
    const incoming = [block("codex", "2026-07-08T00:00:00.000Z", 50)];

    expect(mergeUsageBlocks(existing, incoming, { replaceSources: ["codex"] })).toEqual([
      block("claude", "2026-07-08T00:00:00.000Z", 300),
      block("codex", "2026-07-08T00:00:00.000Z", 50),
    ]);
  });

  it("can replace a source with an empty corrected history", () => {
    const existing = [
      block("codex", "2026-07-08T00:00:00.000Z", 100),
      block("claude", "2026-07-08T00:00:00.000Z", 300),
    ];

    expect(mergeUsageBlocks(existing, [], { replaceSources: ["codex"] })).toEqual([
      block("claude", "2026-07-08T00:00:00.000Z", 300),
    ]);
  });

  it("keeps merge-only behavior for incremental and older clients", () => {
    const existing = [
      block("codex", "2026-07-08T00:00:00.000Z", 100),
      block("codex", "2026-07-08T00:30:00.000Z", 200),
    ];
    const incoming = [block("codex", "2026-07-08T00:00:00.000Z", 50)];

    expect(mergeUsageBlocks(existing, incoming)).toEqual([
      block("codex", "2026-07-08T00:00:00.000Z", 50),
      block("codex", "2026-07-08T00:30:00.000Z", 200),
    ]);
  });

  it("treats legacy sourceless blocks as Claude during replacement", () => {
    const existing = [block(undefined, "2026-07-08T00:00:00.000Z", 100)];

    expect(mergeUsageBlocks(existing, [block("claude", "2026-07-08T00:30:00.000Z", 50)], {
      replaceSources: ["claude"],
    })).toEqual([block("claude", "2026-07-08T00:30:00.000Z", 50)]);
  });

  it("does not store newly uploaded opt-in non-ranking sources", () => {
    const openclaw = block("openclaw", "2026-07-08T00:00:00.000Z", 100);

    expect(mergeUsageBlocks([], [openclaw], { trackedSources: ["openclaw"] })).toEqual([]);
  });

  it("prunes legacy opt-in blocks after the client stops tracking them", () => {
    const openclaw = block("openclaw", "2026-07-08T00:00:00.000Z", 100);

    expect(mergeUsageBlocks([openclaw], [], { trackedSources: [] })).toEqual([]);
  });
});
