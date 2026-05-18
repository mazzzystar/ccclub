import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach, vi } from "vitest";
import { collectUsageEntries } from "../collector.js";
import { aggregateToBlocks } from "../aggregator.js";
import type { UsageEntry } from "@ccclub/shared";

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
      reasoningTokens: 0,
      totalTokens: 110,
    });
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
});
