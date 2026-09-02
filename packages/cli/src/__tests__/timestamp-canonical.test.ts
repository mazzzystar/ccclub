import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach, vi } from "vitest";
import { createCostCalculator, PRICING_SNAPSHOT } from "@ccclub/shared";
import type { AgentSource } from "@ccclub/shared";
import { collectUsageEntries } from "../collector.js";
import { toIsoTimestamp } from "../sources/shared.js";
import { eventsToCollection } from "../sources/cursor.js";
import { parseCursorEvent } from "../sources/cursor-parse.js";

// Sorting entries and turns compares their timestamps as plain strings, which
// is only chronological while every timestamp is canonical ISO — fixed width,
// four-digit year, UTC. This file is the guard on that invariant: it holds
// toIsoTimestamp to it and then checks the actual output of every collector,
// so a new source that mints timestamps some other way fails here rather than
// silently reordering someone's history.
const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const calculateCost = createCostCalculator(PRICING_SNAPSHOT);
const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ccclub-iso-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function expectCanonical(label: string, timestamps: string[]): void {
  expect(timestamps.length, `${label} produced no timestamps to check`).toBeGreaterThan(0);
  for (const timestamp of timestamps) {
    expect(timestamp, label).toMatch(CANONICAL_ISO);
    // Round-tripping catches anything shaped right but not actually UTC.
    expect(new Date(timestamp).toISOString(), label).toBe(timestamp);
  }
}

async function collectTimestamps(source: AgentSource): Promise<string[]> {
  const result = await collectUsageEntries({ sources: [source], calculateCost });
  const collection = result.sources[0];
  expect(collection.warnings, `${source} warned`).toEqual([]);
  return [
    ...collection.entries.map((entry) => entry.timestamp),
    ...collection.turns.map((turn) => turn.timestamp),
  ];
}

describe("toIsoTimestamp", () => {
  it("mints canonical ISO from strings, seconds and milliseconds", () => {
    expectCanonical("toIsoTimestamp", [
      toIsoTimestamp("2026-05-01T00:00:01Z")!,
      toIsoTimestamp("2026-05-01T02:00:01+02:00")!,
      toIsoTimestamp(1_787_641_275)!,
      toIsoTimestamp(1_787_641_275_311)!,
    ]);
    expect(toIsoTimestamp("2026-05-01T02:00:01+02:00")).toBe("2026-05-01T00:00:01.000Z");
  });

  it("rejects values Date would render in its extended-year form", () => {
    // Microseconds read as milliseconds — the realistic way a far-future
    // timestamp gets into a log. `+055840-…` sorts before every real
    // timestamp, so it must never become an entry.
    expect(new Date(1.7e15).toISOString()).toBe("+055840-11-08T22:13:20.000Z");
    expect(toIsoTimestamp(1.7e15)).toBeNull();
    expect(toIsoTimestamp("+055840-11-08T22:13:20.000Z")).toBeNull();
    expect(toIsoTimestamp("-000001-12-31T23:59:59.999Z")).toBeNull();
    expect(toIsoTimestamp(253_402_300_800_000)).toBeNull();
    // The boundaries themselves stay canonical and stay accepted.
    expect(toIsoTimestamp(253_402_300_799_999)).toBe("9999-12-31T23:59:59.999Z");
    expect(toIsoTimestamp("0000-01-01T00:00:00.000Z")).toBe("0000-01-01T00:00:00.000Z");
  });

  it("rejects unparsable and non-date values", () => {
    expect(toIsoTimestamp("not-a-date")).toBeNull();
    expect(toIsoTimestamp(Number.NaN)).toBeNull();
    expect(toIsoTimestamp(null)).toBeNull();
    expect(toIsoTimestamp({})).toBeNull();
  });
});

describe("every collector emits canonical ISO timestamps", () => {
  it("claude", async () => {
    const claudeHome = await makeTempDir();
    const projectsDir = join(claudeHome, "projects");
    await mkdir(projectsDir, { recursive: true });
    await writeFile(join(projectsDir, "session.jsonl"), [
      JSON.stringify({
        type: "user",
        timestamp: "2026-05-01T00:00:00Z",
        sessionId: "session-a",
        message: { content: "hi" },
      }),
      JSON.stringify({
        type: "assistant",
        // Offset, not Z, and no milliseconds: the collector must normalize.
        timestamp: "2026-05-01T02:00:01+02:00",
        sessionId: "session-a",
        requestId: "req-a",
        message: { id: "msg-a", model: "claude-opus-4-6", usage: { input_tokens: 5, output_tokens: 7 } },
      }),
    ].join("\n"));
    vi.stubEnv("CLAUDE_CONFIG_DIR", claudeHome);

    expectCanonical("claude", await collectTimestamps("claude"));
  });

  it("codex", async () => {
    const codexHome = await makeTempDir();
    const sessionsDir = join(codexHome, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, "session.jsonl"), [
      JSON.stringify({
        type: "session_meta",
        timestamp: "2026-05-01T00:00:00Z",
        payload: { id: "logical-a" },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-05-01T00:00:01Z",
        payload: { type: "task_started", turn_id: "turn-1", started_at: 1_777_000_000 },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-05-01T00:00:02Z",
        payload: { type: "user_message", message: "hi" },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-05-01T02:00:03+02:00",
        payload: {
          type: "token_count",
          info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10 } },
        },
      }),
    ].join("\n"));
    vi.stubEnv("CODEX_HOME", codexHome);

    expectCanonical("codex", await collectTimestamps("codex"));
  });

  it("opencode", async () => {
    const openCodeDir = await makeTempDir();
    const messageDir = join(openCodeDir, "storage", "message");
    await mkdir(messageDir, { recursive: true });
    await writeFile(join(messageDir, "message.json"), JSON.stringify({
      id: "msg-1",
      sessionID: "session-a",
      providerID: "openai",
      modelID: "gpt-5",
      // Epoch milliseconds, the shape OpenCode actually writes.
      time: { created: Date.UTC(2026, 4, 1, 1, 2, 3) },
      tokens: { input: 100, output: 50, reasoning: 10, cache: { write: 20, read: 5 } },
      cost: 0.02,
    }));
    vi.stubEnv("OPENCODE_DATA_DIR", openCodeDir);

    expectCanonical("opencode", await collectTimestamps("opencode"));
  });

  it("amp", async () => {
    const ampDir = await makeTempDir();
    const threadsDir = join(ampDir, "threads");
    await mkdir(threadsDir, { recursive: true });
    await writeFile(join(threadsDir, "thread.json"), JSON.stringify({
      id: "thread-a",
      messages: [
        {
          role: "assistant",
          messageId: 2,
          usage: { cacheCreationInputTokens: 30, cacheReadInputTokens: 40 },
        },
      ],
      usageLedger: {
        events: [
          {
            timestamp: Date.UTC(2026, 4, 1, 3, 4, 5),
            model: "claude-opus-4-6",
            toMessageId: 2,
            tokens: { input: 11, output: 22 },
          },
        ],
      },
    }));
    vi.stubEnv("AMP_DATA_DIR", ampDir);

    expectCanonical("amp", await collectTimestamps("amp"));
  });

  it("pi", async () => {
    const piDir = await makeTempDir();
    await mkdir(join(piDir, "project"), { recursive: true });
    await writeFile(join(piDir, "project", "session.jsonl"), JSON.stringify({
      timestamp: "2026-05-01T06:07:08Z",
      message: {
        role: "assistant",
        model: "claude-opus-4-6",
        usage: { input: 10, output: 20, cacheRead: 5, cacheWrite: 3, cost: { total: 0.01 } },
      },
    }));
    vi.stubEnv("PI_AGENT_DIR", piDir);

    expectCanonical("pi", await collectTimestamps("pi"));
  });

  it("grok", async () => {
    const grokHome = await makeTempDir();
    const sessionDir = join(grokHome, "sessions", "project", "s1");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "updates.jsonl"), [
      JSON.stringify({
        timestamp: "2026-08-18T09:01:00.000Z",
        params: {
          update: {
            sessionUpdate: "turn_completed",
            usage: {
              inputTokens: 10_000,
              cachedReadTokens: 2_000,
              outputTokens: 2_000,
              totalTokens: 12_000,
              modelUsage: { "grok-4.6-build": {} },
            },
          },
        },
      }),
      // Epoch seconds, the other shape Grok writes.
      JSON.stringify({
        timestamp: 1_787_043_780,
        params: {
          update: {
            sessionUpdate: "turn_completed",
            usage: { inputTokens: 200, outputTokens: 20, totalTokens: 220, modelUsage: { "grok-4.5": {} } },
          },
        },
      }),
    ].join("\n"));
    vi.stubEnv("GROK_HOME", grokHome);

    expectCanonical("grok", await collectTimestamps("grok"));
  });

  it("cursor", () => {
    // The only API-backed collector: its events never touch the filesystem,
    // so it is driven through the same function the fetch path feeds.
    const events = [
      // Cursor sends epoch milliseconds, sometimes as a string.
      { timestamp: "1787641275311", model: "claude-fable-5-thinking-high", tokenUsage: { inputTokens: 2, outputTokens: 1025, totalCents: 10 }, conversationId: "conv-1" },
      { timestamp: 1_787_641_276_311, model: "gpt-5", tokenUsage: { inputTokens: 3, outputTokens: 4, totalCents: 20 }, conversationId: "conv-2" },
    ].map(parseCursorEvent);
    const collection = eventsToCollection(
      events.filter((event): event is NonNullable<typeof event> => event != null),
      { calculateCost },
    );

    expectCanonical("cursor", [
      ...collection.entries.map((entry) => entry.timestamp),
      ...collection.turns.map((turn) => turn.timestamp),
    ]);
  });
});
