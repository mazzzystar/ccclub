import { describe, it, expect } from "vitest";
import { filterBlocksToSync, needsPricingResync } from "../commands/sync.js";
import type { UsageBlock } from "@ccclub/shared";

const block = (source: UsageBlock["source"], blockStart: string): UsageBlock => ({
  source,
  blockStart,
  blockEnd: blockStart,
  inputTokens: 1,
  outputTokens: 1,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 2,
  costUSD: 0.1,
  models: ["m"],
  entryCount: 1,
});

const OLD = "2026-01-01T00:00:00.000Z";
const CUTOFF = "2026-06-01T00:00:00.000Z";
const NEW = "2026-07-01T00:00:00.000Z";

describe("filterBlocksToSync", () => {
  it("uploads the full history of a source with no sync marker yet", () => {
    // A newly supported source (or a tool the user just started using) must
    // not lose its history to the global cutoff.
    const blocks = [block("claude", OLD), block("claude", NEW), block("amp", OLD)];
    const result = filterBlocksToSync(blocks, {
      lastSync: CUTOFF,
      lastSyncBySource: { claude: CUTOFF },
      hasSourceState: true,
      firstSync: false,
    });
    expect(result).toEqual([block("claude", NEW), block("amp", OLD)]);
  });

  it("filters incrementally per source when markers exist", () => {
    const blocks = [block("codex", OLD), block("codex", NEW)];
    const result = filterBlocksToSync(blocks, {
      lastSync: CUTOFF,
      lastSyncBySource: { codex: CUTOFF },
      hasSourceState: true,
      firstSync: false,
    });
    expect(result).toEqual([block("codex", NEW)]);
  });

  it("keeps the global cutoff for installs that predate per-source markers", () => {
    const blocks = [block("codex", OLD), block("codex", NEW)];
    const result = filterBlocksToSync(blocks, {
      lastSync: CUTOFF,
      lastSyncBySource: {},
      hasSourceState: false,
      firstSync: false,
    });
    expect(result).toEqual([block("codex", NEW)]);
  });

  it("uploads everything on first or forced syncs", () => {
    const blocks = [block("claude", OLD)];
    expect(filterBlocksToSync(blocks, { lastSync: CUTOFF, lastSyncBySource: {}, hasSourceState: true, firstSync: true })).toEqual(blocks);
    expect(filterBlocksToSync(blocks, { lastSync: null, lastSyncBySource: {}, hasSourceState: false, firstSync: false })).toEqual(blocks);
  });

  it("treats sourceless legacy blocks as claude", () => {
    const legacy = block(undefined, NEW);
    const result = filterBlocksToSync([legacy, block(undefined, OLD)], {
      lastSync: CUTOFF,
      lastSyncBySource: { claude: CUTOFF },
      hasSourceState: true,
      firstSync: false,
    });
    expect(result).toEqual([legacy]);
  });
});

describe("needsPricingResync", () => {
  it("replaces stored history only when an existing sync used another price table", () => {
    expect(needsPricingResync(false, null, "pricing-v2")).toBe(false);
    expect(needsPricingResync(true, null, "pricing-v2")).toBe(true);
    expect(needsPricingResync(true, "pricing-v1", "pricing-v2")).toBe(true);
    expect(needsPricingResync(true, "pricing-v2", "pricing-v2")).toBe(false);
  });
});
