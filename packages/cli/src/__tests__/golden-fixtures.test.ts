import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectUsageEntries } from "../collector.js";
import { aggregateToBlocks } from "../aggregator.js";

const GOLDEN_DIR = fileURLToPath(new URL("./fixtures/golden", import.meta.url));

interface GoldenExpected {
  entries: number;
  humanTurns: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheCreationTokens?: number;
  cacheCreation1hTokens?: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUSD: number;
}

async function expected(name: string): Promise<GoldenExpected> {
  return JSON.parse(await readFile(join(GOLDEN_DIR, name, "expected.json"), "utf8")) as GoldenExpected;
}

afterEach(() => vi.unstubAllEnvs());

describe("golden accounting fixtures", () => {
  it("matches the Fable 5 one-hour cache-write reference", async () => {
    const fixture = join(GOLDEN_DIR, "claude-fable-1h");
    const golden = await expected("claude-fable-1h");
    vi.stubEnv("CLAUDE_CONFIG_DIR", join(fixture, "projects"));

    const result = await collectUsageEntries({ sources: ["claude"] });
    const blocks = aggregateToBlocks(result.entries, result.humanTurns);
    const entry = result.entries[0];

    expect(result.entries).toHaveLength(golden.entries);
    expect(result.humanTurns).toHaveLength(golden.humanTurns);
    expect(entry).toMatchObject({
      inputTokens: golden.inputTokens,
      outputTokens: golden.outputTokens,
      cacheCreationTokens: golden.cacheCreationTokens,
      cacheCreation1hTokens: golden.cacheCreation1hTokens,
      cacheReadTokens: golden.cacheReadTokens,
      totalTokens: golden.totalTokens,
    });
    expect(entry.costUSD).toBeCloseTo(golden.costUSD, 10);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].costUSD).toBeCloseTo(golden.costUSD, 10);
  });

  it("matches the Codex parent/subagent replay reference", async () => {
    const fixture = join(GOLDEN_DIR, "codex-replay");
    const golden = await expected("codex-replay");
    vi.stubEnv("CODEX_HOME", fixture);

    const result = await collectUsageEntries({ sources: ["codex"] });
    const totals = result.entries.reduce((sum, entry) => ({
      inputTokens: sum.inputTokens + entry.inputTokens,
      outputTokens: sum.outputTokens + entry.outputTokens,
      cacheReadTokens: sum.cacheReadTokens + entry.cacheReadTokens,
      totalTokens: sum.totalTokens + entry.totalTokens,
      costUSD: sum.costUSD + entry.costUSD,
    }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0, costUSD: 0 });

    expect(result.entries).toHaveLength(golden.entries);
    expect(result.humanTurns).toHaveLength(golden.humanTurns);
    expect(totals).toMatchObject({
      inputTokens: golden.inputTokens,
      outputTokens: golden.outputTokens,
      cacheReadTokens: golden.cacheReadTokens,
      totalTokens: golden.totalTokens,
    });
    expect(totals.costUSD).toBeCloseTo(golden.costUSD, 10);
  });

  it("matches ccusage when Codex output already contains reasoning", async () => {
    const fixture = join(GOLDEN_DIR, "codex-reasoning");
    const golden = await expected("codex-reasoning");
    vi.stubEnv("CODEX_HOME", fixture);

    const result = await collectUsageEntries({ sources: ["codex"] });
    const entry = result.entries[0];

    expect(result.entries).toHaveLength(golden.entries);
    expect(result.humanTurns).toHaveLength(golden.humanTurns);
    expect(entry).toMatchObject({
      inputTokens: golden.inputTokens,
      outputTokens: golden.outputTokens,
      reasoningTokens: golden.reasoningTokens,
      cacheReadTokens: golden.cacheReadTokens,
      totalTokens: golden.totalTokens,
    });
    expect(entry.costUSD).toBeCloseTo(golden.costUSD, 10);
  });
});
