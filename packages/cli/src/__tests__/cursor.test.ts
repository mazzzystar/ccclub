import { describe, expect, it } from "vitest";
import { createCostCalculator, DEFAULT_SOURCES, OPT_IN_SOURCES, getNonCacheTokens, PRICING_SNAPSHOT } from "@ccclub/shared";
import { collectCursorUsage, cursorStartMs } from "../sources/cursor.js";
import { cursorTotalTokens, parseCursorEvent, parseCursorEventsPage } from "../sources/cursor-parse.js";
import { parseSources } from "../sources/index.js";
import { priceUsageFact } from "../sources/types.js";
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
  it("keeps every token bucket and Cursor's own cost", () => {
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

  it("reports no cost at all when neither cents field is present", () => {
    // Absence is not $0. Collapsing the two would put a free price on a
    // request Cursor did charge for, and nothing downstream could tell.
    const event = parseCursorEvent({
      timestamp: "1787641275311",
      model: "gpt-5",
      tokenUsage: { inputTokens: 10, outputTokens: 20 },
    });
    expect(event?.costUSD).toBeUndefined();
  });

  it("falls back to chargedCents only when totalCents is missing or zero", () => {
    const missing = parseCursorEvent({
      timestamp: "1787641275311",
      model: "gpt-5",
      tokenUsage: { inputTokens: 1, outputTokens: 1 },
      chargedCents: 250,
    });
    expect(missing?.costUSD).toBeCloseTo(2.5);

    const zeroTotal = parseCursorEvent({
      timestamp: "1787641275311",
      model: "gpt-5",
      tokenUsage: { inputTokens: 1, outputTokens: 1, totalCents: 0 },
      chargedCents: 250,
    });
    expect(zeroTotal?.costUSD).toBeCloseTo(2.5);

    // A present totalCents wins over a disagreeing chargedCents.
    const both = parseCursorEvent({
      timestamp: "1787641275311",
      model: "gpt-5",
      tokenUsage: { inputTokens: 1, outputTokens: 1, totalCents: "100" },
      chargedCents: 250,
    });
    expect(both?.costUSD).toBeCloseTo(1);

    // Both zero is still a real answer: free.
    const free = parseCursorEvent({
      timestamp: "1787641275311",
      model: "gpt-5",
      tokenUsage: { inputTokens: 1, outputTokens: 1, totalCents: "0" },
      chargedCents: 0,
    });
    expect(free?.costUSD).toBe(0);
  });
});

describe("priceUsageFact cost precedence", () => {
  const fact = {
    source: "cursor" as const,
    timestamp: "2026-08-25T07:01:15.311Z",
    sessionId: "s",
    model: "claude-fable-5-thinking-high",
    inputTokens: 12,
    outputTokens: 34,
    cacheCreationTokens: 0,
    cacheReadTokens: 2_000_000,
    totalTokens: 2_000_046,
  };

  it("treats a negative reported cost as no answer and prices it instead", () => {
    const priced = priceUsageFact(fact, context).costUSD;
    expect(priced).toBeGreaterThan(0);
    expect(priceUsageFact({ ...fact, reportedCostUSD: -1 }, context).costUSD).toBe(priced);
    // Zero is still a real answer, and still wins.
    expect(priceUsageFact({ ...fact, reportedCostUSD: 0 }, context).costUSD).toBe(0);
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
    expect(parsed.events.map(cursorTotalTokens)).toEqual([2, 4]);
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

  // Pins the whole dashboard-row → UsageEntry mapping. Any change to token
  // accounting, cost handling, or turn counting has to come through here.
  it("maps dashboard events into priced entries counting every token bucket", async () => {
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
      // input + output + cacheWrite + cacheRead, same as every other source.
      totalTokens: 257_430,
      costUSD: expect.closeTo(0.3185865, 8),
    });
    // Leaderboard fairness comes from the non-cache view, not from Cursor
    // under-reporting its totals.
    expect(getNonCacheTokens(result.entries[0])).toBe(1027);

    const blocks = aggregateToBlocks(result.entries, result.turns);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source).toBe("cursor");
    expect(blocks[0].chatCount).toBe(1);
    expect(blocks[0].entryCount).toBe(2);
    expect(blocks[0].totalTokens).toBe(513_847);
  });

  it("trusts a reported cost of zero instead of inventing one", async () => {
    // An included / free Cursor request still burns a huge cached prompt. The
    // LiteLLM table has a rule for this model family and would happily bill
    // it — Cursor's own number is the only correct answer.
    const result = await collectCursorUsage(context, {
      readToken: async () => "test-token",
      fetchPage: async (_token, page) => page === 1
        ? {
          totalUsageEventsCount: 1,
          usageEventsDisplay: [{
            timestamp: "1787641275311",
            model: "claude-fable-5-thinking-high",
            tokenUsage: {
              inputTokens: 12,
              outputTokens: 34,
              cacheWriteTokens: 0,
              cacheReadTokens: 2_000_000,
              totalCents: 0,
            },
            chargedCents: 0,
            conversationId: "free-1",
          }],
        }
        : { usageEventsDisplay: [] },
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].costUSD).toBe(0);
    expect(result.entries[0].totalTokens).toBe(2_000_046);
    // Sanity: the pricing table really would have charged for this.
    expect(calculateCost("claude-fable-5-thinking-high", 12, 34, 0, 2_000_000)).toBeGreaterThan(0);
  });

  it("prices events that report no cost, and says so once", async () => {
    // Cursor has always sent a cents field. A run where some rows have none
    // is schema drift: those entries quietly become estimates, so the run
    // carries one warning saying how many — not one per event.
    const noCentsRow = (index: number) => ({
      timestamp: String(1_787_641_275_311 + index),
      model: "claude-fable-5-thinking-high",
      tokenUsage: { inputTokens: 12, outputTokens: 34, cacheWriteTokens: 0, cacheReadTokens: 2_000_000 },
      conversationId: `drift-${index}`,
    });
    const result = await collectCursorUsage(context, {
      readToken: async () => "test-token",
      fetchPage: async (_token, page) => page === 1
        ? { totalUsageEventsCount: 2, usageEventsDisplay: [noCentsRow(0), noCentsRow(1)] }
        : { usageEventsDisplay: [] },
    });

    expect(result.entries).toHaveLength(2);
    const expected = calculateCost("claude-fable-5-thinking-high", 12, 34, 0, 2_000_000);
    expect(expected).toBeGreaterThan(0);
    for (const entry of result.entries) expect(entry.costUSD).toBe(expected);
    expect(result.warnings).toEqual([
      "Cursor: 2 usage events reported no cost — estimated from the pricing table instead",
    ]);
  });

  it("reports no records when the API returns nothing usable", async () => {
    // files > 0 is what lets a full sync replace stored Cursor history. An
    // empty window — or a response whose shape changed — must not be read as
    // "this user has no Cursor history" and wipe the server's copy.
    const empty = await collectCursorUsage(context, {
      readToken: async () => "test-token",
      fetchPage: async () => ({ totalUsageEventsCount: 0, usageEventsDisplay: [] }),
    });
    expect(empty).toEqual({ source: "cursor", entries: [], turns: [], files: 0, warnings: [] });

    const reshaped = await collectCursorUsage(context, {
      readToken: async () => "test-token",
      fetchPage: async () => ({ events: [{ tokens: 1 }] }),
    });
    expect(reshaped.files).toBe(0);
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

describe("cursor fetch window", () => {
  const now = Date.parse("2026-08-25T12:00:00.000Z");
  const fullWindow = now - 400 * 24 * 60 * 60 * 1000;

  it("asks for the full retention window with no watermark", () => {
    expect(cursorStartMs(undefined, now)).toBe(fullWindow);
    expect(cursorStartMs("not-a-date", now)).toBe(fullWindow);
  });

  it("resumes an hour before the watermark, enough to cover its own block", () => {
    // The watermark is a 30-minute block START, so that block may still be
    // open. An hour covers it and its late arrivals; anything older than the
    // watermark is dropped by filterBlocksToSync before upload anyway, so a
    // wider window would only cost pages.
    expect(cursorStartMs("2026-08-20T00:00:00.000Z", now))
      .toBe(Date.parse("2026-08-19T23:00:00.000Z"));
  });

  it("never reaches back further than the retention window", () => {
    expect(cursorStartMs("2020-01-01T00:00:00.000Z", now)).toBe(fullWindow);
  });

  it("narrows the request once a sync has landed", async () => {
    const windows: Array<[number, number]> = [];
    await collectCursorUsage(
      { ...context, lastSyncBySource: { cursor: "2026-08-24T00:00:00.000Z" } },
      {
        readToken: async () => "test-token",
        fetchPage: async (_token, _page, startMs, endMs) => {
          windows.push([startMs, endMs]);
          return { totalUsageEventsCount: 0, usageEventsDisplay: [] };
        },
      },
      now,
    );

    expect(windows).toEqual([[Date.parse("2026-08-23T23:00:00.000Z"), now]]);
  });

  it("refetches everything when the watermark is gone", async () => {
    // Sync deletes a source's marker to force a repair; that has to translate
    // back into a full window here.
    const windows: Array<[number, number]> = [];
    await collectCursorUsage(
      { ...context, lastSyncBySource: {} },
      {
        readToken: async () => "test-token",
        fetchPage: async (_token, _page, startMs, endMs) => {
          windows.push([startMs, endMs]);
          return { totalUsageEventsCount: 0, usageEventsDisplay: [] };
        },
      },
      now,
    );

    expect(windows).toEqual([[fullWindow, now]]);
  });
});

describe("cursor pagination", () => {
  const row = (index: number) => ({
    timestamp: String(1_787_641_275_311 + index),
    model: "gpt-5",
    tokenUsage: { inputTokens: 1, outputTokens: 1, totalCents: 1 },
    conversationId: `c${index}`,
  });

  it("keeps paging while the reported total says there is more", async () => {
    // A page can be short because this parser rejected rows, not because the
    // results ended. The server's own count is the authority.
    const pages: number[] = [];
    const result = await collectCursorUsage(context, {
      readToken: async () => "test-token",
      fetchPage: async (_token, page) => {
        pages.push(page);
        if (page > 3) return { totalUsageEventsCount: 250, usageEventsDisplay: [] };
        return {
          totalUsageEventsCount: 250,
          usageEventsDisplay: Array.from(
            { length: page === 3 ? 50 : 100 },
            (_, i) => row(page * 1000 + i),
          ),
        };
      },
    });

    expect(pages).toEqual([1, 2, 3]);
    expect(result.entries).toHaveLength(250);
  });

  it("stops on a short page when the server reports no total", async () => {
    const pages: number[] = [];
    await collectCursorUsage(context, {
      readToken: async () => "test-token",
      fetchPage: async (_token, page) => {
        pages.push(page);
        return { usageEventsDisplay: Array.from({ length: 20 }, (_, i) => row(page * 1000 + i)) };
      },
    });

    expect(pages).toEqual([1]);
  });

  it("warns instead of silently truncating a long history", async () => {
    const result = await collectCursorUsage(context, {
      readToken: async () => "test-token",
      fetchPage: async (_token, page) => ({
        totalUsageEventsCount: 100_000,
        usageEventsDisplay: Array.from({ length: 100 }, (_, i) => row(page * 1000 + i)),
      }),
    });

    expect(result.entries).toHaveLength(5_000);
    expect(result.warnings).toEqual(["Cursor: only the most recent 5000 usage events were read"]);
    expect(result.files).toBe(1);
    // The flag, not just the sentence: sync reads it to hold the watermark.
    expect(result.truncated).toBe(true);
  });
});
