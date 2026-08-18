import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach, vi } from "vitest";
import { collectUsageEntries } from "../collector.js";
import { aggregateToBlocks } from "../aggregator.js";
import { createCostCalculator, DEFAULT_SOURCES, getNonCacheTokens, PRICING_SNAPSHOT } from "@ccclub/shared";
import type { UsageEntry } from "@ccclub/shared";
import { parseSources } from "../sources/index.js";
import { createScanCacheFactory } from "../scan-cache.js";

const calculateCost = createCostCalculator(PRICING_SNAPSHOT);

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ccclub-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("multi-agent collection", () => {
  it("keeps the largest Claude usage record for repeated message/request IDs", async () => {
    const claudeHome = await makeTempDir();
    const projectsDir = join(claudeHome, "projects");
    await mkdir(projectsDir, { recursive: true });
    const baseEntry = {
      type: "assistant",
      timestamp: "2026-05-01T00:00:01.000Z",
      sessionId: "session-a",
      requestId: "req-a",
      message: {
        id: "msg-a",
        model: "claude-opus-4-6",
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 1000,
        },
      },
    };
    await writeFile(join(projectsDir, "session.jsonl"), [
      JSON.stringify(baseEntry),
      JSON.stringify({
        ...baseEntry,
        message: {
          ...baseEntry.message,
          usage: {
            ...baseEntry.message.usage,
            output_tokens: 10,
          },
        },
      }),
    ].join("\n"));
    vi.stubEnv("CLAUDE_CONFIG_DIR", claudeHome);

    const result = await collectUsageEntries({ sources: ["claude"] });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].outputTokens).toBe(10);
  });

  it("tracks and prices Claude 1h cache writes as a subset of total writes", async () => {
    const claudeHome = await makeTempDir();
    const projectsDir = join(claudeHome, "projects");
    await mkdir(projectsDir, { recursive: true });
    await writeFile(join(projectsDir, "session.jsonl"), JSON.stringify({
      type: "assistant",
      timestamp: "2026-07-14T00:00:01.000Z",
      sessionId: "session-fable",
      requestId: "req-fable",
      message: {
        id: "msg-fable",
        model: "claude-fable-5",
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 1_000_000,
          cache_read_input_tokens: 0,
          cache_creation: {
            ephemeral_5m_input_tokens: 400_000,
            ephemeral_1h_input_tokens: 600_000,
          },
        },
      },
    }));
    vi.stubEnv("CLAUDE_CONFIG_DIR", claudeHome);

    const result = await collectUsageEntries({ sources: ["claude"] });
    const blocks = aggregateToBlocks(result.entries);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].cacheCreationTokens).toBe(1_000_000);
    expect(result.entries[0].cacheCreation1hTokens).toBe(600_000);
    expect(result.entries[0].costUSD).toBeCloseTo(17);
    expect(blocks[0].cacheCreationTokens).toBe(1_000_000);
    expect(blocks[0].cacheCreation1hTokens).toBe(600_000);
    expect(blocks[0].costUSD).toBeCloseTo(17);
  });

  it("keeps Claude parent usage when sidechain replays a message with a new request ID", async () => {
    const claudeHome = await makeTempDir();
    const projectsDir = join(claudeHome, "projects");
    await mkdir(projectsDir, { recursive: true });
    const parentEntry = {
      type: "assistant",
      timestamp: "2026-05-01T00:00:01.000Z",
      sessionId: "session-a",
      requestId: "req-parent",
      isSidechain: false,
      message: {
        id: "msg-parent",
        model: "claude-opus-4-6",
        usage: {
          input_tokens: 1,
          output_tokens: 10,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 20,
        },
      },
    };
    await writeFile(join(projectsDir, "session.jsonl"), [
      JSON.stringify({
        ...parentEntry,
        requestId: "req-sidechain-replay",
        isSidechain: true,
        message: {
          ...parentEntry.message,
          usage: {
            ...parentEntry.message.usage,
            cache_read_input_tokens: 50_000,
          },
        },
      }),
      JSON.stringify(parentEntry),
      JSON.stringify({
        ...parentEntry,
        timestamp: "2026-05-01T00:00:02.000Z",
        requestId: "req-sidechain-answer",
        isSidechain: true,
        message: {
          ...parentEntry.message,
          id: "msg-sidechain-answer",
          usage: {
            ...parentEntry.message.usage,
            output_tokens: 30,
            cache_read_input_tokens: 700,
          },
        },
      }),
    ].join("\n"));
    vi.stubEnv("CLAUDE_CONFIG_DIR", claudeHome);

    const result = await collectUsageEntries({ sources: ["claude"] });

    expect(result.entries).toHaveLength(2);
    const parent = result.entries.find((entry) => entry.requestId === "req-parent");
    const sidechainAnswer = result.entries.find((entry) => entry.requestId === "req-sidechain-answer");
    expect(parent).toMatchObject({
      outputTokens: 10,
      cacheReadTokens: 20,
    });
    expect(sidechainAnswer).toMatchObject({
      outputTokens: 30,
      cacheReadTokens: 700,
    });
  });

  it("loads Codex token_count events and separates cached input tokens", async () => {
    const codexHome = await makeTempDir();
    const sessionsDir = join(codexHome, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, "session.jsonl"), [
      JSON.stringify({
        timestamp: "2026-05-01T00:00:00.000Z",
        type: "turn_context",
        payload: { model: "gpt-5" },
      }),
      JSON.stringify({
        timestamp: "2026-05-01T00:00:01.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 25,
              output_tokens: 10,
              reasoning_output_tokens: 5,
              total_tokens: 110,
            },
          },
        },
      }),
    ].join("\n"));
    vi.stubEnv("CODEX_HOME", codexHome);

    const result = await collectUsageEntries({ sources: ["codex"] });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      source: "codex",
      model: "gpt-5",
      inputTokens: 75,
      outputTokens: 10,
      cacheReadTokens: 25,
      reasoningTokens: 5,
      totalTokens: 110,
    });
  });

  it("counts Codex turns from task starts, not token count events", async () => {
    const codexHome = await makeTempDir();
    const sessionsDir = join(codexHome, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, "session.jsonl"), [
      JSON.stringify({
        timestamp: "2026-05-01T00:00:00.000Z",
        type: "turn_context",
        payload: { model: "gpt-5" },
      }),
      JSON.stringify({
        timestamp: "2026-05-01T00:00:01.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-a", started_at: "2026-05-01T00:00:01.000Z" },
      }),
      JSON.stringify({
        timestamp: "2026-05-01T00:00:02.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { last_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } },
        },
      }),
      JSON.stringify({
        timestamp: "2026-05-01T00:00:03.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { last_token_usage: { input_tokens: 50, output_tokens: 5, total_tokens: 55 } },
        },
      }),
    ].join("\n"));
    vi.stubEnv("CODEX_HOME", codexHome);

    const result = await collectUsageEntries({ sources: ["codex"] });
    const blocks = aggregateToBlocks(result.entries, result.humanTurns);

    expect(result.entries).toHaveLength(2);
    expect(result.humanTurns).toHaveLength(1);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].entryCount).toBe(2);
    expect(blocks[0].chatCount).toBe(1);
  });

  it("dedupes copied Codex fork history across session files", async () => {
    const codexHome = await makeTempDir();
    const sessionsDir = join(codexHome, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const copiedHistory = [
      JSON.stringify({
        timestamp: "2026-05-01T00:00:00.000Z",
        type: "turn_context",
        payload: { model: "gpt-5.5" },
      }),
      JSON.stringify({
        timestamp: "2026-05-01T00:00:01.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-a", started_at: "2026-05-01T00:00:01.000Z" },
      }),
      JSON.stringify({
        timestamp: "2026-05-01T00:00:02.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 100,
              output_tokens: 200,
              reasoning_output_tokens: 20,
              total_tokens: 1200,
            },
          },
        },
      }),
    ].join("\n");
    await writeFile(join(sessionsDir, "root.jsonl"), copiedHistory);
    await writeFile(join(sessionsDir, "fork.jsonl"), copiedHistory);
    vi.stubEnv("CODEX_HOME", codexHome);

    const result = await collectUsageEntries({ sources: ["codex"] });
    const blocks = aggregateToBlocks(result.entries, result.humanTurns);

    expect(result.entries).toHaveLength(1);
    expect(result.humanTurns).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      inputTokens: 900,
      cacheReadTokens: 100,
      outputTokens: 200,
      reasoningTokens: 20,
      totalTokens: 1200,
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].entryCount).toBe(1);
    expect(blocks[0].chatCount).toBe(1);
  });

  it("skips re-stamped Codex subagent history and keeps only the child work", async () => {
    const codexHome = await makeTempDir();
    const sessionsDir = join(codexHome, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const tokenCount = (timestamp: string, input: number, output: number, total: number) => ({
      timestamp,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          model: "gpt-5.2",
          last_token_usage: { input_tokens: input, output_tokens: output, total_tokens: input + output },
          total_token_usage: { input_tokens: total - output, output_tokens: output, total_tokens: total },
        },
      },
    });
    await writeFile(join(sessionsDir, "parent.jsonl"), [
      JSON.stringify({ timestamp: "2026-05-12T08:00:00.000Z", type: "turn_context", payload: { model: "gpt-5.2" } }),
      JSON.stringify({
        timestamp: "2026-05-12T08:00:30.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "parent-turn", started_at: "2026-05-12T08:00:30.000Z" },
      }),
      JSON.stringify(tokenCount("2026-05-12T08:01:00.000Z", 1000, 200, 1200)),
      JSON.stringify(tokenCount("2026-05-12T08:02:00.000Z", 500, 100, 1800)),
    ].join("\n"));
    const spawn = "2026-05-12T08:03:00.000Z";
    await writeFile(join(sessionsDir, "subagent.jsonl"), [
      JSON.stringify({
        timestamp: spawn,
        type: "session_meta",
        payload: {
          id: "child",
          source: { subagent: { thread_spawn: { parent_thread_id: "parent" } } },
        },
      }),
      JSON.stringify({ timestamp: spawn, type: "session_meta", payload: { id: "parent" } }),
      JSON.stringify({
        timestamp: spawn,
        type: "event_msg",
        payload: { type: "task_started", turn_id: "copied-parent-turn", started_at: "2026-05-12T08:00:30.000Z" },
      }),
      JSON.stringify(tokenCount(spawn, 1000, 200, 1200)),
      JSON.stringify(tokenCount(spawn, 500, 100, 1800)),
      JSON.stringify({
        timestamp: "2026-05-12T08:04:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "child-turn", started_at: "2026-05-12T08:04:00.000Z" },
      }),
      JSON.stringify(tokenCount("2026-05-12T08:04:10.000Z", 100, 20, 120)),
    ].join("\n"));
    vi.stubEnv("CODEX_HOME", codexHome);

    const result = await collectUsageEntries({ sources: ["codex"] });
    const blocks = aggregateToBlocks(result.entries, result.humanTurns);

    expect(result.entries).toHaveLength(3);
    expect(result.entries.reduce((sum, entry) => sum + entry.totalTokens, 0)).toBe(1920);
    expect(result.humanTurns).toHaveLength(2);
    expect(blocks.reduce((sum, block) => sum + (block.chatCount ?? 0), 0)).toBe(2);
  });

  it("matches Last-N-turn subagent replay by parent fingerprint with only new metadata markers", async () => {
    const codexHome = await makeTempDir();
    const sessionsDir = join(codexHome, "sessions");
    const cacheDir = await makeTempDir();
    await mkdir(sessionsDir, { recursive: true });

    const parentStart = "2026-07-19T00:00:00.000Z";
    const spawnMs = Date.parse("2026-07-19T01:00:00.000Z");
    const tokenCount = (timestamp: string, ordinal: number) => ({
      timestamp,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          model: "gpt-5.6-sol",
          last_token_usage: {
            input_tokens: 1000 + ordinal,
            cached_input_tokens: 900 + ordinal,
            output_tokens: 20 + ordinal,
            reasoning_output_tokens: 5 + ordinal,
            total_tokens: 1020 + ordinal * 2,
          },
          total_token_usage: {
            input_tokens: (ordinal + 1) * 1000,
            cached_input_tokens: (ordinal + 1) * 900,
            output_tokens: (ordinal + 1) * 20,
            reasoning_output_tokens: (ordinal + 1) * 5,
            total_tokens: (ordinal + 1) * 1020,
          },
        },
      },
    });
    const parentTokens = Array.from({ length: 120 }, (_, index) => tokenCount(
      new Date(Date.parse(parentStart) + (index + 1) * 1000).toISOString(),
      index,
    ));
    const parentRecords = [
      {
        timestamp: parentStart,
        type: "session_meta",
        payload: { id: "parent-session", timestamp: parentStart },
      },
      {
        timestamp: parentStart,
        type: "event_msg",
        payload: { type: "task_started", turn_id: "parent-turn", started_at: parentStart },
      },
      ...parentTokens,
    ];
    const parentPath = join(sessionsDir, "parent.jsonl");
    await writeFile(parentPath, parentRecords.map((record) => JSON.stringify(record)).join("\n"));

    // New Codex variants may expose only thread_source + parent_thread_id.
    // Replayed records can span many seconds, so the old same-second heuristic
    // cannot recognize this Last-N suffix.
    const replayedSuffix = parentTokens.slice(-100).map((record, index) => {
      const payload = record.payload;
      return {
        ...record,
        timestamp: new Date(spawnMs + index * 1000).toISOString(),
        payload: {
          ...payload,
          info: {
            ...payload.info,
            last_token_usage: {
              ...payload.info.last_token_usage,
              cache_write_input_tokens: 0,
            },
            total_token_usage: {
              ...payload.info.total_token_usage,
              cache_write_input_tokens: 0,
            },
          },
        },
      };
    });
    const childOwnStart = new Date(spawnMs + 120_000).toISOString();
    const childRecords = [
      {
        timestamp: new Date(spawnMs).toISOString(),
        type: "session_meta",
        payload: {
          id: "child-session",
          timestamp: new Date(spawnMs).toISOString(),
          thread_source: "subagent",
          parent_thread_id: "parent-session",
        },
      },
      ...replayedSuffix,
      {
        timestamp: childOwnStart,
        type: "event_msg",
        payload: { type: "turn_started", turn_id: "child-turn", started_at: childOwnStart },
      },
      tokenCount(new Date(spawnMs + 121_000).toISOString(), 120),
    ];
    await writeFile(
      join(sessionsDir, "child.jsonl"),
      childRecords.map((record) => JSON.stringify(record)).join("\n"),
    );
    vi.stubEnv("CODEX_HOME", codexHome);

    const openScanCache = createScanCacheFactory(cacheDir);
    const first = await collectUsageEntries({ sources: ["codex"], openScanCache });
    const hot = await collectUsageEntries({ sources: ["codex"], openScanCache });

    expect(first.entries).toHaveLength(121);
    expect(first.humanTurns).toHaveLength(2);
    expect(hot.entries).toEqual(first.entries);
    expect(hot.humanTurns).toEqual(first.humanTurns);

    // The parent may continue after the child spawned. Only that changed file
    // is rescanned; the cached child still has to match the parent-at-spawn
    // suffix rather than the parent's new final suffix.
    const laterParentRecord = tokenCount(new Date(spawnMs + 300_000).toISOString(), 121);
    await writeFile(
      parentPath,
      [...parentRecords, laterParentRecord].map((record) => JSON.stringify(record)).join("\n"),
    );
    const afterParentGrowth = await collectUsageEntries({ sources: ["codex"], openScanCache });

    expect(afterParentGrowth.entries).toHaveLength(122);
    expect(afterParentGrowth.humanTurns).toHaveLength(2);
  });

  it("suppresses duplicate Codex token_count emissions with unchanged cumulative totals", async () => {
    const codexHome = await makeTempDir();
    const sessionsDir = join(codexHome, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const tokenCount = (timestamp: string, input: number, output: number, cumulative: number) => ({
      timestamp,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          model: "gpt-5.6-sol",
          last_token_usage: { input_tokens: input, output_tokens: output, total_tokens: input + output },
          total_token_usage: { input_tokens: cumulative - output, output_tokens: output, total_tokens: cumulative },
        },
      },
    });
    const duplicate = tokenCount("2026-07-19T02:00:02.000Z", 100, 10, 110);
    await writeFile(join(sessionsDir, "session.jsonl"), [
      JSON.stringify(tokenCount("2026-07-19T02:00:01.000Z", 100, 10, 110)),
      JSON.stringify(duplicate),
      JSON.stringify(tokenCount("2026-07-19T02:00:03.000Z", 200, 20, 330)),
    ].join("\n"));
    vi.stubEnv("CODEX_HOME", codexHome);

    const result = await collectUsageEntries({ sources: ["codex"] });

    expect(result.entries).toHaveLength(2);
    expect(result.entries.reduce((sum, entry) => sum + entry.totalTokens, 0)).toBe(330);
  });

  it("does not mistake an interior parent token for a Last-N replay suffix", async () => {
    const codexHome = await makeTempDir();
    const sessionsDir = join(codexHome, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const tokenCount = (timestamp: string, input: number, output: number, cumulative: number) => ({
      timestamp,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          model: "gpt-5.6-sol",
          last_token_usage: { input_tokens: input, output_tokens: output, total_tokens: input + output },
          total_token_usage: { input_tokens: cumulative - output, output_tokens: output, total_tokens: cumulative },
        },
      },
    });
    const first = tokenCount("2026-07-19T04:00:01.000Z", 10, 1, 11);
    const second = tokenCount("2026-07-19T04:00:02.000Z", 20, 2, 33);
    await writeFile(join(sessionsDir, "parent.jsonl"), [
      JSON.stringify({
        timestamp: "2026-07-19T04:00:00.000Z",
        type: "session_meta",
        payload: { id: "interior-parent", timestamp: "2026-07-19T04:00:00.000Z" },
      }),
      JSON.stringify(first),
      JSON.stringify(second),
    ].join("\n"));
    await writeFile(join(sessionsDir, "fork.jsonl"), [
      JSON.stringify({
        timestamp: "2026-07-19T04:30:00.000Z",
        type: "session_meta",
        payload: {
          id: "interior-fork",
          timestamp: "2026-07-19T04:30:00.000Z",
          forked_from_id: "interior-parent",
        },
      }),
      // Same payload as the parent's first (interior) token, but the current
      // parent snapshot ends with `second`, so this is not valid replay proof.
      JSON.stringify({ ...first, timestamp: "2026-07-19T04:30:01.000Z" }),
      JSON.stringify(tokenCount("2026-07-19T04:30:02.000Z", 5, 3, 41)),
    ].join("\n"));
    vi.stubEnv("CODEX_HOME", codexHome);

    const result = await collectUsageEntries({ sources: ["codex"] });

    expect(result.entries).toHaveLength(4);
    expect(result.entries.reduce((sum, entry) => sum + entry.totalTokens, 0)).toBe(52);
  });

  it("keeps only the most complete live/archive copy of one logical Codex session", async () => {
    const codexHome = await makeTempDir();
    const sessionsDir = join(codexHome, "sessions");
    const archivedDir = join(codexHome, "archived_sessions");
    await mkdir(sessionsDir, { recursive: true });
    await mkdir(archivedDir, { recursive: true });
    const meta = JSON.stringify({
      timestamp: "2026-07-19T03:00:00.000Z",
      type: "session_meta",
      payload: { id: "same-logical-session", timestamp: "2026-07-19T03:00:00.000Z" },
    });
    const usageLine = (timestamp: string, input: number) => JSON.stringify({
      timestamp,
      type: "event_msg",
      payload: { type: "token_count", info: {
        model: "gpt-5.6-sol",
        last_token_usage: { input_tokens: input, output_tokens: 10, total_tokens: input + 10 },
      } },
    });
    await writeFile(join(sessionsDir, "live-name.jsonl"), [
      meta,
      usageLine("2026-07-19T03:00:01.000Z", 100),
    ].join("\n"));
    await writeFile(join(archivedDir, "different-archive-name.jsonl"), [
      meta,
      usageLine("2026-07-19T03:00:01.000Z", 100),
      usageLine("2026-07-19T03:00:02.000Z", 50),
    ].join("\n"));
    vi.stubEnv("CODEX_HOME", codexHome);

    const result = await collectUsageEntries({ sources: ["codex"] });

    expect(result.entries).toHaveLength(2);
    expect(result.entries.reduce((sum, entry) => sum + entry.totalTokens, 0)).toBe(170);
  });

  it("keeps the cumulative baseline while skipping Codex replay records", async () => {
    const codexHome = await makeTempDir();
    const sessionsDir = join(codexHome, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const cumulative = (timestamp: string, input: number, cached: number, output: number) => JSON.stringify({
      timestamp,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { model: "gpt-5.2", total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
          total_tokens: input + output,
        } },
      },
    });
    const spawn = "2026-05-12T08:03:00.000Z";
    await writeFile(join(sessionsDir, "subagent.jsonl"), [
      JSON.stringify({
        timestamp: spawn,
        type: "session_meta",
        payload: { id: "child", forked_from_id: "parent" },
      }),
      cumulative(spawn, 1000, 100, 200),
      cumulative(spawn, 1500, 150, 300),
      cumulative("2026-05-12T08:04:00.000Z", 1600, 160, 320),
    ].join("\n"));
    vi.stubEnv("CODEX_HOME", codexHome);

    const result = await collectUsageEntries({ sources: ["codex"] });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      inputTokens: 90,
      cacheReadTokens: 10,
      outputTokens: 20,
      totalTokens: 120,
    });
  });

  it("does not infer replay from a single creation-second Codex usage event", async () => {
    const codexHome = await makeTempDir();
    const sessionsDir = join(codexHome, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, "fork.jsonl"), [
      JSON.stringify({
        timestamp: "2026-05-12T08:03:00.000Z",
        type: "session_meta",
        payload: { id: "fork", forked_from_id: "parent" },
      }),
      JSON.stringify({
        timestamp: "2026-05-12T08:03:00.000Z",
        type: "event_msg",
        payload: { type: "token_count", info: {
          model: "gpt-5.2",
          last_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        } },
      }),
      JSON.stringify({
        timestamp: "2026-05-12T08:04:00.000Z",
        type: "event_msg",
        payload: { type: "token_count", info: {
          model: "gpt-5.2",
          last_token_usage: { input_tokens: 50, output_tokens: 10, total_tokens: 60 },
        } },
      }),
    ].join("\n"));
    vi.stubEnv("CODEX_HOME", codexHome);

    const result = await collectUsageEntries({ sources: ["codex"] });

    expect(result.entries).toHaveLength(2);
    expect(result.entries.reduce((sum, entry) => sum + entry.totalTokens, 0)).toBe(180);
  });

  it("counts a marker-only Codex subagent without replay evidence in full", async () => {
    const codexHome = await makeTempDir();
    const sessionsDir = join(codexHome, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const spawn = "2026-07-19T05:00:00.000Z";
    const tokenCount = (input: number, output: number) => JSON.stringify({
      timestamp: spawn,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          model: "gpt-5.6-sol",
          last_token_usage: { input_tokens: input, output_tokens: output, total_tokens: input + output },
        },
      },
    });
    await writeFile(join(sessionsDir, "subagent.jsonl"), [
      JSON.stringify({
        timestamp: spawn,
        type: "session_meta",
        payload: {
          id: "marker-only-child",
          timestamp: spawn,
          thread_source: "subagent",
          parent_thread_id: "missing-parent",
        },
      }),
      tokenCount(1_000, 100),
      tokenCount(2_000, 200),
    ].join("\n"));
    vi.stubEnv("CODEX_HOME", codexHome);

    const result = await collectUsageEntries({ sources: ["codex"] });

    expect(result.entries).toHaveLength(2);
    expect(result.entries.reduce((sum, entry) => sum + entry.totalTokens, 0)).toBe(3_300);
  });

  it("loads Codex archives and lets a live file win the same relative path", async () => {
    const codexHome = await makeTempDir();
    const sessionsDir = join(codexHome, "sessions");
    const archivedDir = join(codexHome, "archived_sessions");
    await mkdir(join(sessionsDir, "nested"), { recursive: true });
    await mkdir(join(archivedDir, "nested"), { recursive: true });
    const usageLine = (timestamp: string, input: number) => JSON.stringify({
      timestamp,
      type: "event_msg",
      payload: { type: "token_count", info: {
        model: "gpt-5.2",
        last_token_usage: { input_tokens: input, output_tokens: 10, total_tokens: input + 10 },
      } },
    });
    await writeFile(join(sessionsDir, "nested", "same.jsonl"), usageLine("2026-05-12T08:00:00.000Z", 100));
    await writeFile(join(archivedDir, "nested", "same.jsonl"), usageLine("2026-05-12T08:00:00.000Z", 900));
    await writeFile(join(archivedDir, "archive-only.jsonl"), usageLine("2026-05-12T09:00:00.000Z", 50));
    vi.stubEnv("CODEX_HOME", codexHome);

    const result = await collectUsageEntries({ sources: ["codex"] });

    expect(result.sources[0].files).toBe(2);
    expect(result.entries).toHaveLength(2);
    expect(result.entries.reduce((sum, entry) => sum + entry.inputTokens, 0)).toBe(150);
  });

  it("applies Codex fast service tier pricing from config", async () => {
    const codexHome = await makeTempDir();
    const sessionsDir = join(codexHome, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(codexHome, "config.toml"), 'model = "gpt-5.5"\nservice_tier = "fast"\n');
    await writeFile(join(sessionsDir, "session.jsonl"), [
      JSON.stringify({
        timestamp: "2026-05-01T00:00:00.000Z",
        type: "turn_context",
        payload: { model: "gpt-5.5" },
      }),
      JSON.stringify({
        timestamp: "2026-05-01T00:00:01.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 20,
              output_tokens: 10,
              total_tokens: 110,
            },
          },
        },
      }),
    ].join("\n"));
    vi.stubEnv("CODEX_HOME", codexHome);

    const result = await collectUsageEntries({ sources: ["codex"] });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].costUSD).toBeCloseTo(0.001775, 8);
  });

  it("matches ccusage Codex fallback totals when total_tokens is omitted", async () => {
    const codexHome = await makeTempDir();
    const sessionsDir = join(codexHome, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, "session.jsonl"), [
      JSON.stringify({
        timestamp: "2026-05-01T00:00:00.000Z",
        type: "turn_context",
        payload: { model: "gpt-5.5" },
      }),
      JSON.stringify({
        timestamp: "2026-05-01T00:00:01.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 20,
              output_tokens: 10,
              reasoning_output_tokens: 5,
            },
          },
        },
      }),
    ].join("\n"));
    vi.stubEnv("CODEX_HOME", codexHome);

    const result = await collectUsageEntries({ sources: ["codex"] });

    expect(result.entries).toHaveLength(1);
    // Codex/OpenAI total is input + output; reasoning is already a subset of
    // output and must not be added again when total_tokens is absent.
    expect(result.entries[0].totalTokens).toBe(110);
    expect(result.entries[0].reasoningTokens).toBe(5);
    // Codex output_tokens already includes reasoning_output_tokens. The
    // reasoning breakdown must remain visible without being billed twice.
    expect(result.entries[0].costUSD).toBeCloseTo(0.00071, 8);
    expect(getNonCacheTokens(result.entries[0])).toBe(90);
  });

  it("loads OpenCode JSON message usage", async () => {
    const openCodeDir = await makeTempDir();
    const messageDir = join(openCodeDir, "storage", "message");
    await mkdir(messageDir, { recursive: true });
    await writeFile(join(messageDir, "message.json"), JSON.stringify({
      id: "msg-1",
      sessionID: "session-a",
      providerID: "openai",
      modelID: "gpt-5",
      time: { created: Date.UTC(2026, 4, 1, 1, 2, 3) },
      tokens: {
        input: 100,
        output: 50,
        reasoning: 10,
        cache: { write: 20, read: 5 },
      },
      cost: 0.02,
    }));
    vi.stubEnv("OPENCODE_DATA_DIR", openCodeDir);

    const result = await collectUsageEntries({ sources: ["opencode"] });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      source: "opencode",
      model: "openai/gpt-5",
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 20,
      cacheReadTokens: 5,
      reasoningTokens: 10,
      totalTokens: 185,
      costUSD: 0.02,
    });
    // OpenCode reports reasoning separately from output, so it remains an
    // additional non-cache bucket for that source.
    expect(getNonCacheTokens(result.entries[0])).toBe(160);
  });

  it("loads Grok unified.jsonl inference, model switches, and prompt turns", async () => {
    const grokHome = await makeTempDir();
    const logsDir = join(grokHome, "logs");
    await mkdir(logsDir, { recursive: true });
    await writeFile(join(logsDir, "unified.jsonl"), [
      JSON.stringify({
        ts: "2026-08-18T09:00:00.000Z",
        sid: "s1",
        pid: 1,
        msg: "model changed",
        ctx: { model: "grok-4.6" },
      }),
      JSON.stringify({
        ts: "2026-08-18T09:00:01.000Z",
        sid: "s1",
        pid: 1,
        msg: "shell.handle_prompt.start",
        ctx: { prompt_id: "p1" },
      }),
      JSON.stringify({
        ts: "2026-08-18T09:01:00.000Z",
        sid: "s1",
        pid: 1,
        msg: "shell.turn.inference_done",
        ctx: {
          prompt_tokens: 10_000,
          cached_prompt_tokens: 2_000,
          completion_tokens: 500,
          reasoning_tokens: 1_500,
        },
      }),
      JSON.stringify({
        ts: "2026-08-18T09:02:00.000Z",
        sid: "s2",
        pid: 2,
        msg: "backend_search: model switch",
        ctx: { new_model: "grok-4.5" },
      }),
      JSON.stringify({
        ts: "2026-08-18T09:03:00.000Z",
        sid: "s2",
        pid: 2,
        msg: "shell.turn.inference_done",
        ctx: {
          prompt_tokens: 200,
          cached_prompt_tokens: 0,
          completion_tokens: 20,
          reasoning_tokens: 0,
        },
      }),
      JSON.stringify({
        ts: "2026-08-18T09:04:00.000Z",
        sid: "s1",
        pid: 1,
        msg: "shell.turn.inference_start",
        ctx: { loop_index: 2 },
      }),
      JSON.stringify({
        ts: "2026-08-18T09:05:00.000Z",
        sid: "s3",
        msg: "shell.turn.inference_done",
        ctx: {
          prompt_tokens: 0,
          cached_prompt_tokens: 0,
          completion_tokens: 0,
          reasoning_tokens: 0,
        },
      }),
    ].join("\n"));
    vi.stubEnv("GROK_HOME", grokHome);

    const result = await collectUsageEntries({ sources: ["grok"] });

    expect(result.entries).toHaveLength(2);
    expect(result.humanTurns).toHaveLength(1);
    const first = result.entries.find((entry) => entry.sessionId === "s1");
    const second = result.entries.find((entry) => entry.sessionId === "s2");
    expect(first).toMatchObject({
      source: "grok",
      model: "grok-4.6",
      inputTokens: 8_000,
      outputTokens: 500,
      cacheCreationTokens: 0,
      cacheReadTokens: 2_000,
      reasoningTokens: 1_500,
      totalTokens: 12_000,
    });
    expect(second).toMatchObject({
      source: "grok",
      model: "grok-4.5",
      inputTokens: 200,
      outputTokens: 20,
      cacheReadTokens: 0,
      reasoningTokens: 0,
      totalTokens: 220,
    });
    // Grok reports reasoning separately from completion, so it stays an
    // additional non-cache bucket — same as OpenCode, unlike Codex.
    expect(getNonCacheTokens(first!)).toBe(10_000);
    // grok-4.6: 8k input * $2 + 2k cache * $0.5 + (500+1500) output * $6 / 1M
    expect(first!.costUSD).toBeCloseTo(0.029);
  });

  it("falls back to grok-4.6 when unified.jsonl never announces a model", async () => {
    const grokHome = await makeTempDir();
    await mkdir(join(grokHome, "logs"), { recursive: true });
    await writeFile(join(grokHome, "logs", "unified.jsonl"), JSON.stringify({
      ts: "2026-08-18T09:00:00.000Z",
      sid: "s1",
      msg: "shell.turn.inference_done",
      ctx: {
        prompt_tokens: 100,
        cached_prompt_tokens: 0,
        completion_tokens: 50,
        reasoning_tokens: 0,
      },
    }));
    vi.stubEnv("GROK_HOME", grokHome);

    const result = await collectUsageEntries({ sources: ["grok"] });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].model).toBe("grok-4.6");
    expect(result.humanTurns).toHaveLength(0);
  });

  it("collects Grok by default and skips an empty GROK_HOME", async () => {
    const emptyHome = await makeTempDir();
    vi.stubEnv("GROK_HOME", emptyHome);

    const result = await collectUsageEntries({ sources: ["grok"] });

    expect(DEFAULT_SOURCES).toContain("grok");
    expect(parseSources(undefined)).toContain("grok");
    expect(result.entries).toHaveLength(0);
    expect(result.sources).toEqual([
      { source: "grok", entries: [], turns: [], files: 0, warnings: [] },
    ]);
  });

  it("never collects non-coding sources, even when requested explicitly", () => {
    // OpenClaw is a personal assistant — the coding leaderboard must not
    // count it, and the server additionally excludes it from rankings.
    expect(DEFAULT_SOURCES).not.toContain("openclaw");
    expect(parseSources(undefined)).toEqual([...DEFAULT_SOURCES]);
    expect(parseSources("openclaw")).toEqual([...DEFAULT_SOURCES]); // not collectable
    expect(parseSources("codex,openclaw")).toEqual(["codex"]);
  });

  it("keeps same-window blocks separate by agent source", () => {
    const baseEntry = {
      timestamp: "2026-05-01T00:05:00.000Z",
      sessionId: "s",
      model: "gpt-5",
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 15,
      costUSD: 0.01,
    } satisfies Omit<UsageEntry, "source">;

    const blocks = aggregateToBlocks([
      { ...baseEntry, source: "claude", model: "claude-sonnet-4-5-20250929" },
      { ...baseEntry, source: "codex" },
    ], [
      { source: "claude", timestamp: baseEntry.timestamp, key: "claude-turn" },
      { source: "codex", timestamp: baseEntry.timestamp, key: "codex-turn" },
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.source).sort()).toEqual(["claude", "codex"]);
    expect(blocks.every((block) => block.chatCount === 1)).toBe(true);
  });

  it("stores the latest real activity time inside each aggregate block", () => {
    const blocks = aggregateToBlocks([
      {
        source: "codex",
        timestamp: "2026-05-01T00:02:00.000Z",
        sessionId: "s",
        model: "gpt-5",
        inputTokens: 10,
        outputTokens: 5,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 15,
        costUSD: 0.01,
      },
      {
        source: "codex",
        timestamp: "2026-05-01T00:27:30.000Z",
        sessionId: "s",
        model: "gpt-5",
        inputTokens: 10,
        outputTokens: 5,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 15,
        costUSD: 0.01,
      },
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].blockStart).toBe("2026-05-01T00:00:00.000Z");
    expect(blocks[0].blockEnd).toBe("2026-05-01T00:30:00.000Z");
    expect(blocks[0].lastActivityAt).toBe("2026-05-01T00:27:30.000Z");
  });

  it("prices current Claude and Codex models before broad family fallbacks", () => {
    expect(calculateCost("gpt-5.5", 1_000_000, 1_000_000, 0, 1_000_000)).toBeCloseTo(56);
    expect(calculateCost("openai/gpt-5.5-extra", 1_000_000, 0, 0, 0)).toBeCloseTo(10);
    expect(calculateCost("gpt-5.3-codex", 1_000_000, 1_000_000, 0, 1_000_000)).toBeCloseTo(15.925);
    expect(calculateCost("gpt-5.4-mini-latest", 1_000_000, 1_000_000, 0, 1_000_000)).toBeCloseTo(5.325);
    expect(calculateCost("codex-auto-review", 1_000_000, 1_000_000, 0, 1_000_000)).toBe(0);
    expect(calculateCost("claude-opus-4-7", 1_000_000, 1_000_000, 1_000_000, 1_000_000)).toBeCloseTo(36.75);
  });
});
