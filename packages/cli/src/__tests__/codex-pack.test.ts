import { describe, it, expect } from "vitest";
import { importLegacyCodexScan, packCodexScan, unpackCodexScan } from "../sources/codex.js";
import type { PackedCodexScan } from "../sources/codex.js";

const SESSION = "2026/07/27/rollout-2026-07-27T18-04-11-019fa2d1";

function fact(overrides: Record<string, unknown> = {}) {
  const base = {
    source: "codex" as const,
    timestamp: "2026-07-27T09:04:11.366Z",
    sessionId: SESSION,
    model: "gpt-5.6-sol",
    inputTokens: 18_313,
    outputTokens: 627,
    cacheCreationTokens: 0,
    cacheReadTokens: 11_008,
    reasoningTokens: 223,
    totalTokens: 29_948,
    ...overrides,
  };
  const derived = [
    base.timestamp, base.model, base.inputTokens, base.cacheReadTokens,
    base.outputTokens, base.reasoningTokens, base.totalTokens,
  ].join(":");
  return { ...base, requestId: (overrides.requestId as string | undefined) ?? derived };
}

function scanWith(entries: Array<Record<string, unknown>>) {
  return {
    logicalSessionId: "019fa2d1",
    forkedFromId: null,
    parentThreadId: null,
    sessionStartedAtMs: 1_785_300_000_000,
    isSubagent: false,
    sessionMetaCount: 1,
    parsedRecordCount: entries.length,
    rawTokenCount: entries.length,
    tokenTimes: entries.map((_, i) => 1_785_300_000_000 + i),
    tokenFingerprints: entries.map((_, i) => `fp-${i}`),
    taskBoundaries: [],
    firstTaskBoundary: null,
    ownTaskBoundary: null,
    legacyReplayTokenCount: 0,
    entries: entries.map((f, i) => ({ fact: f, recordIndex: i * 3, rawTokenIndex: i })),
    taskTurns: [],
    fallbackUserTurns: [],
  } as never;
}

describe("packCodexScan / unpackCodexScan", () => {
  it("roundtrips a typical scan exactly", () => {
    const scan = scanWith([
      fact(),
      fact({ timestamp: "2026-07-27T09:05:02.101Z", inputTokens: 900, totalTokens: 12_530 }),
      fact({ timestamp: "2026-07-27T09:06:40.000Z", model: "gpt-5.6-terra" }),
    ]);
    const packed = packCodexScan(scan);
    expect(unpackCodexScan(packed)).toEqual(scan);
    // Everything fit the columns; nothing fell back to verbatim storage.
    expect(packed.packedEntries.irregular).toEqual([]);
    expect(packed.packedEntries.models).toEqual(["gpt-5.6-sol", "gpt-5.6-terra"]);
  });

  it("roundtrips an empty scan", () => {
    const scan = scanWith([]);
    expect(unpackCodexScan(packCodexScan(scan))).toEqual(scan);
  });

  it("is dramatically smaller than the object form", () => {
    const entries = Array.from({ length: 500 }, (_, i) =>
      fact({ timestamp: new Date(1_785_300_000_000 + i * 60_000).toISOString(), inputTokens: 1_000 + i }));
    const scan = scanWith(entries);
    const packedBytes = JSON.stringify(packCodexScan(scan)).length;
    const plainBytes = JSON.stringify(scan).length;
    expect(unpackCodexScan(packCodexScan(scan))).toEqual(scan);
    expect(packedBytes).toBeLessThan(plainBytes * 0.45);
  });

  it("carries invariant-breaking entries verbatim, in order", () => {
    const odd = fact({ requestId: "server-supplied-id-123" }); // not derivable
    const foreignSession = fact({ sessionId: "some/other/rollout" });
    const scan = scanWith([fact(), odd, foreignSession, fact({ inputTokens: 5 })]);
    const packed = packCodexScan(scan);
    expect(packed.packedEntries.irregular.map((x) => x.at)).toEqual([1, 2]);
    expect(unpackCodexScan(packed)).toEqual(scan);
  });

  it("keeps a provider-reported cost out of the lossy columns", () => {
    const scan = scanWith([fact({ reportedCostUSD: 1.25 })]);
    const packed = packCodexScan(scan);
    expect(packed.packedEntries.irregular).toHaveLength(1);
    expect(unpackCodexScan(packed)).toEqual(scan);
  });
});

describe("importLegacyCodexScan", () => {
  it("converts a v5 object-shaped scan into the packed form", () => {
    const scan = scanWith([fact(), fact({ timestamp: "2026-07-27T09:05:02.101Z", totalTokens: 100 })]);
    const packed = importLegacyCodexScan(JSON.parse(JSON.stringify(scan))) as PackedCodexScan;
    expect(packed).not.toBeNull();
    expect(unpackCodexScan(packed)).toEqual(scan);
  });

  it("rejects shapes it does not recognize instead of guessing", () => {
    expect(importLegacyCodexScan(null)).toBeNull();
    expect(importLegacyCodexScan({ entries: "nope" })).toBeNull();
    expect(importLegacyCodexScan({ entries: [], tokenTimes: [] })).toBeNull(); // no fingerprints
    // Already-packed data is not the legacy shape.
    expect(importLegacyCodexScan(packCodexScan(scanWith([fact()])))).toBeNull();
  });
});
