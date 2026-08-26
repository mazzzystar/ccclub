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
    const existing = [block(undefined, "2026-07-08T00:30:00.000Z", 100)];

    expect(mergeUsageBlocks(existing, [block("claude", "2026-07-08T00:00:00.000Z", 50)], {
      replaceSources: ["claude"],
    })).toEqual([block("claude", "2026-07-08T00:00:00.000Z", 50)]);
  });

  it("keeps history older than the upload's coverage window on a full sync", () => {
    // The ventuss scenario: months of synced history on the server, then a
    // format bump forces a full sync from a disk that only retains ~30 days.
    // An unscoped replace would truncate the server history to that window.
    const existing = [
      block("claude", "2026-02-10T00:00:00.000Z", 400), // long rotated off disk
      block("claude", "2026-05-01T00:00:00.000Z", 500), // long rotated off disk
      block("claude", "2026-07-20T00:00:00.000Z", 100), // inside the window, stale parse
      block("codex", "2025-09-25T10:30:00.000Z", 5),    // other source untouched
    ];
    const incoming = [
      block("claude", "2026-07-19T00:00:00.000Z", 80),
      block("claude", "2026-08-18T00:00:00.000Z", 90),
    ];

    expect(mergeUsageBlocks(existing, incoming, { replaceSources: ["claude"] })).toEqual([
      block("codex", "2025-09-25T10:30:00.000Z", 5),
      block("claude", "2026-02-10T00:00:00.000Z", 400),
      block("claude", "2026-05-01T00:00:00.000Z", 500),
      block("claude", "2026-07-19T00:00:00.000Z", 80),
      block("claude", "2026-08-18T00:00:00.000Z", 90),
    ]);
  });

  it("drops in-window blocks missing from the corrected upload", () => {
    // Inside the covered window the upload is authoritative — that is the
    // parser-fix cleanup the replace exists for.
    const existing = [
      block("codex", "2026-07-08T00:00:00.000Z", 100),
      block("codex", "2026-07-08T01:00:00.000Z", 999), // obsolete after a parser fix
    ];
    const incoming = [block("codex", "2026-07-08T00:00:00.000Z", 50)];

    expect(mergeUsageBlocks(existing, incoming, { replaceSources: ["codex"] })).toEqual([
      block("codex", "2026-07-08T00:00:00.000Z", 50),
    ]);
  });

  it("scopes each replaced source to its own window", () => {
    const existing = [
      block("claude", "2026-01-01T00:00:00.000Z", 1),
      block("codex", "2026-01-01T00:00:00.000Z", 2),
    ];
    const incoming = [
      block("claude", "2026-06-01T00:00:00.000Z", 10), // claude window starts June
      block("codex", "2025-12-01T00:00:00.000Z", 20),  // codex window covers January
    ];

    expect(mergeUsageBlocks(existing, incoming, { replaceSources: ["claude", "codex"] })).toEqual([
      block("codex", "2025-12-01T00:00:00.000Z", 20),
      block("claude", "2026-01-01T00:00:00.000Z", 1),
      block("claude", "2026-06-01T00:00:00.000Z", 10),
    ]);
  });

  it("does not store newly uploaded opt-in non-ranking sources", () => {
    const openclaw = block("openclaw", "2026-07-08T00:00:00.000Z", 100);

    expect(mergeUsageBlocks([], [openclaw], { trackedSources: ["openclaw"] })).toEqual([]);
  });

  it("prunes legacy opt-in blocks after the client stops tracking them", () => {
    const openclaw = block("openclaw", "2026-07-08T00:00:00.000Z", 100);

    expect(mergeUsageBlocks([openclaw], [], { trackedSources: [] })).toEqual([]);
  });

  it("stores Cursor blocks — opt-in collection, but a ranked coding source", () => {
    const cursor = block("cursor", "2026-07-08T00:00:00.000Z", 100);

    expect(mergeUsageBlocks([], [cursor], { trackedSources: ["claude", "cursor"] })).toEqual([cursor]);
  });

  it("keeps Cursor history when a second machine syncs without it enabled", () => {
    // The user enabled Cursor on their laptop; their desktop still reports
    // only the defaults. Pruning on trackedSources would make the two
    // machines erase each other's history on every sync.
    const cursor = block("cursor", "2026-07-08T00:00:00.000Z", 100);
    const claude = block("claude", "2026-07-08T00:30:00.000Z", 200);

    expect(mergeUsageBlocks([cursor], [claude], { trackedSources: ["claude", "codex"] })).toEqual([
      cursor,
      claude,
    ]);
  });
});
