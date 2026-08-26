import { describe, expect, it } from "vitest";
import { createCostCalculator, DEFAULT_SOURCES, OPT_IN_SOURCES, getNonCacheTokens, PRICING_SNAPSHOT } from "@ccclub/shared";
import { collectCursorUsage } from "../sources/cursor.js";
import { parseCursorEvent, parseCursorEventsPage } from "../sources/cursor-parse.js";
import { parseSources } from "../sources/index.js";
import { aggregateToBlocks } from "../aggregator.js";

const calculateCost = createCostCalculator(PRICING_SNAPSHOT);
const context = { calculateCost };

const sampleRow = {
  timestamp: "1787641275311",
  model: "claude-fable-5-thinking-high",
  tokenUsage: {
    inputTokens: 2,
    outputTokens: 1025,
    cacheWriteTokens: 949,
    cacheReadTokens: 255454,
    totalCents: 31.85865,
  },
  chargedCents: 31.85865,
  conversationId: "conv-1",
};

describe("parseCursorEvent", () => {
  it("keeps cache buckets but counts display tokens as input plus output", () => {
    const event = parseCursorEvent(sampleRow);
    expect(event).toMatchObject({
      model: "claude-fable-5-thinking-high",
      inputTokens: 2,
      outputTokens: 1025,
      cacheWriteTokens: 949,
      cacheReadTokens: 255454,
      conversationId: "conv-1",
    });
    expect(event?.timestamp).toBe("2026-08-25T07:01:15.311Z");
    expect(event?.costUSD).toBeCloseTo(0.3185865);
  });

  it("accepts string token fields and millisecond timestamps", () => {
    const event = parseCursorEvent({
      timestamp: 1_787_641_275_311,
      model: "gpt-5",
      tokenUsage: {
        inputTokens: "10",
        outputTokens: "20",
        cacheWriteTokens: "3",
        cacheReadTokens: "400",
        totalCents: "50",
      },
    });
    expect(event).toMatchObject({
      inputTokens: 10,
      outputTokens: 20,
      cacheWriteTokens: 3,
      cacheReadTokens: 400,
    });
    expect(event?.costUSD).toBeCloseTo(0.5);
  });
});

describe("parseCursorEventsPage", () => {
  it("reads usageEventsDisplay and the total count", () => {
    const parsed = parseCursorEventsPage({
      totalUsageEventsCount: 2,
      usageEventsDisplay: [
        { timestamp: "1787641275311", model: "a", tokenUsage: { inputTokens: 1, outputTokens: 1, totalCents: 10 }, conversationId: "c1" },
        { timestamp: "1787641275312", model: "b", tokenUsage: { inputTokens: 2, outputTokens: 2, totalCents: 20 }, conversationId: "c2" },
      ],
    });
    expect(parsed.total).toBe(2);
    expect(parsed.rawCount).toBe(2);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events.map((event) => event.inputTokens + event.outputTokens)).toEqual([2, 4]);
  });
});

describe("collectCursorUsage", () => {
  it("is collectable but opt-in — never in the default set", () => {
    expect(OPT_IN_SOURCES).toContain("cursor");
    expect(DEFAULT_SOURCES).not.toContain("cursor");
    expect(parseSources(undefined)).not.toContain("cursor");
    // Naming it explicitly is a deliberate per-run choice, so it is accepted.
    expect(parseSources("cursor")).toEqual(["cursor"]);
  });

  it("returns nothing when no Cursor token is available", async () => {
    const result = await collectCursorUsage(context, { readToken: async () => undefined });
    expect(result).toEqual({ source: "cursor", entries: [], turns: [], files: 0, warnings: [] });
  });

  it("keeps paging when some raw rows do not parse into usage", async () => {
    const emptyRow = { timestamp: "1787641275311", model: "x", tokenUsage: { inputTokens: 0, outputTokens: 0, totalCents: 0 } };
    const result = await collectCursorUsage(context, {
      readToken: async () => "test-token",
      fetchPage: async (_token, page) => {
        if (page === 1) {
          return {
            totalUsageEventsCount: 101,
            usageEventsDisplay: Array.from({ length: 100 }, (_, i) => i === 0 ? sampleRow : emptyRow),
          };
        }
        if (page === 2) {
          return {
            totalUsageEventsCount: 101,
            usageEventsDisplay: [{
              ...sampleRow,
              timestamp: "1787641276311",
              conversationId: "conv-2",
            }],
          };
        }
        return { usageEventsDisplay: [] };
      },
    });
    expect(result.entries).toHaveLength(2);
    expect(result.turns.map((turn) => turn.key).sort()).toEqual(["cursor:conv-1", "cursor:conv-2"]);
  });

  it("maps dashboard events into priced entries without inflating cache reads", async () => {
    const result = await collectCursorUsage(context, {
      readToken: async () => "test-token",
      fetchPage: async (_token, page) => {
        if (page !== 1) return { usageEventsDisplay: [] };
        return { totalUsageEventsCount: 2, usageEventsDisplay: [sampleRow, {
          ...sampleRow,
          timestamp: "1787641276311",
          conversationId: "conv-1",
          tokenUsage: { ...sampleRow.tokenUsage, inputTokens: 4, outputTokens: 10, totalCents: 5 },
        }] };
      },
    });

    expect(result.files).toBe(1);
    expect(result.entries).toHaveLength(2);
    expect(result.turns).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      source: "cursor",
      model: "claude-fable-5-thinking-high",
      inputTokens: 2,
      outputTokens: 1025,
      cacheCreationTokens: 949,
      cacheReadTokens: 255454,
      totalTokens: 1027,
      costUSD: expect.closeTo(0.3185865, 8),
    });
    expect(getNonCacheTokens(result.entries[0])).toBe(1027);

    const blocks = aggregateToBlocks(result.entries, result.turns);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source).toBe("cursor");
    expect(blocks[0].chatCount).toBe(1);
    expect(blocks[0].entryCount).toBe(2);
    expect(blocks[0].totalTokens).toBe(1041);
  });

  it("surfaces login expiry instead of failing the rest of sync", async () => {
    const result = await collectCursorUsage(context, {
      readToken: async () => "stale",
      fetchPage: async () => {
        throw new Error("Cursor login expired");
      },
    });
    expect(result.entries).toEqual([]);
    expect(result.files).toBe(0);
    expect(result.warnings).toEqual(["Cursor: Cursor login expired"]);
  });
});
