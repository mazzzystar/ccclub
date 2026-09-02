import { describe, it, expect } from "vitest";
import { aggregateToBlocks } from "../aggregator.js";
import type { AgentSource, UsageEntry } from "@ccclub/shared";
import type { UsageTurn } from "../sources/index.js";

function entry(timestamp: string, extra: Partial<UsageEntry> = {}): UsageEntry {
  return {
    source: "claude",
    timestamp,
    model: "claude-opus-4-6",
    inputTokens: 1,
    outputTokens: 1,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 2,
    costUSD: 0.5,
    ...extra,
  } as UsageEntry;
}

function turn(timestamp: string, source: AgentSource = "claude"): UsageTurn {
  return { source, timestamp, key: `${source}:${timestamp}` };
}

describe("aggregateToBlocks", () => {
  it("floors to 30-minute windows and skips windows with no entries", () => {
    const blocks = aggregateToBlocks([
      entry("2026-05-01T00:07:00.000Z"),
      entry("2026-05-01T00:29:59.999Z"),
      // Two empty windows in between: they must not be emitted.
      entry("2026-05-01T01:31:00.000Z"),
    ]);

    expect(blocks.map((block) => block.blockStart)).toEqual([
      "2026-05-01T00:00:00.000Z",
      "2026-05-01T01:30:00.000Z",
    ]);
    expect(blocks.map((block) => block.blockEnd)).toEqual([
      "2026-05-01T00:30:00.000Z",
      "2026-05-01T02:00:00.000Z",
    ]);
    expect(blocks.map((block) => block.entryCount)).toEqual([2, 1]);
  });

  it("reports the latest entry in each block as its last activity", () => {
    const blocks = aggregateToBlocks([
      entry("2026-05-01T00:01:00.000Z"),
      entry("2026-05-01T00:21:00.000Z"),
      entry("2026-05-01T00:41:00.000Z"),
    ]);

    expect(blocks.map((block) => block.lastActivityAt)).toEqual([
      "2026-05-01T00:21:00.000Z",
      "2026-05-01T00:41:00.000Z",
    ]);
  });

  it("counts human turns into the block that contains them", () => {
    const blocks = aggregateToBlocks(
      [entry("2026-05-01T00:10:00.000Z"), entry("2026-05-01T00:40:00.000Z")],
      [
        turn("2026-04-30T23:59:00.000Z"), // before the first block
        turn("2026-05-01T00:05:00.000Z"),
        turn("2026-05-01T00:09:00.000Z"),
        turn("2026-05-01T00:35:00.000Z"),
        turn("2026-05-01T09:00:00.000Z"), // after the last block
      ],
    );

    expect(blocks.map((block) => block.chatCount)).toEqual([2, 1]);
  });

  it("groups by source and orders blocks by start then source", () => {
    const blocks = aggregateToBlocks([
      entry("2026-05-01T00:40:00.000Z", { source: "codex" }),
      entry("2026-05-01T00:10:00.000Z", { source: "codex" }),
      entry("2026-05-01T00:20:00.000Z", { source: "claude" }),
    ], [turn("2026-05-01T00:15:00.000Z", "codex")]);

    expect(blocks.map((block) => [block.source, block.blockStart])).toEqual([
      ["claude", "2026-05-01T00:00:00.000Z"],
      ["codex", "2026-05-01T00:00:00.000Z"],
      ["codex", "2026-05-01T00:30:00.000Z"],
    ]);
    // The turn belongs to Codex's first block, not to Claude's.
    expect(blocks.map((block) => block.chatCount)).toEqual([0, 1, 0]);
  });

  it("orders entries handed over out of order", () => {
    const blocks = aggregateToBlocks([
      entry("2026-05-01T02:00:00.000Z"),
      entry("2026-05-01T00:00:00.000Z"),
      entry("2026-05-01T01:00:00.000Z"),
    ]);

    expect(blocks.map((block) => block.blockStart)).toEqual([
      "2026-05-01T00:00:00.000Z",
      "2026-05-01T01:00:00.000Z",
      "2026-05-01T02:00:00.000Z",
    ]);
  });
});
