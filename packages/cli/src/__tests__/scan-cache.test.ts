import { mkdtemp, mkdir, rm, stat, writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach, vi } from "vitest";
import { createScanCacheFactory } from "../scan-cache.js";
import { collectUsageEntries } from "../collector.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ccclub-scan-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const STAT_A = { mtimeMs: 1_000_000, size: 10 };
const STAT_B = { mtimeMs: 2_000_000, size: 10 };

describe("scan cache factory", () => {
  it("returns cached data across instances for unchanged stats", async () => {
    const factory = createScanCacheFactory(await makeTempDir());

    const first = await factory<string>("codex", "v1");
    expect(first.get("/a.jsonl", STAT_A)).toBeUndefined();
    first.set("/a.jsonl", STAT_A, "parsed-a");
    await first.save();

    const second = await factory<string>("codex", "v1");
    expect(second.get("/a.jsonl", STAT_A)).toBe("parsed-a");
    expect(second.get("/a.jsonl", STAT_B)).toBeUndefined(); // stat changed
  });

  it("invalidates everything when the meta token changes", async () => {
    const dir = await makeTempDir();
    const factory = createScanCacheFactory(dir);

    const v1 = await factory<string>("claude", "pricing-1");
    v1.set("/a.jsonl", STAT_A, "old");
    await v1.save();

    const v2 = await factory<string>("claude", "pricing-2");
    expect(v2.get("/a.jsonl", STAT_A)).toBeUndefined();
  });

  it("prunes files not seen in the latest run", async () => {
    const factory = createScanCacheFactory(await makeTempDir());

    const first = await factory<string>("amp", "v1");
    first.set("/gone.json", STAT_A, "stale");
    first.set("/kept.json", STAT_A, "kept");
    await first.save();

    const second = await factory<string>("amp", "v1");
    expect(second.get("/kept.json", STAT_A)).toBe("kept");
    await second.save(); // /gone.json was never touched → dropped

    const third = await factory<string>("amp", "v1");
    expect(third.get("/gone.json", STAT_A)).toBeUndefined();
    expect(third.get("/kept.json", STAT_A)).toBe("kept");
  });

  it("does not rewrite a fully hot cache", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "claude.json");
    const factory = createScanCacheFactory(dir);

    const first = await factory<string>("claude", "parser=1");
    first.set("/a.jsonl", STAT_A, "parsed-a");
    await first.save();

    const fixedTime = new Date(1_700_000_000_000);
    await utimes(path, fixedTime, fixedTime);

    const hot = await factory<string>("claude", "parser=1");
    expect(hot.get("/a.jsonl", STAT_A)).toBe("parsed-a");
    await hot.save();

    expect((await stat(path)).mtimeMs).toBe(fixedTime.getTime());
  });

  it("treats a corrupt cache file as cold and recovers on save", async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, "pi.json"), "{corrupt");
    const factory = createScanCacheFactory(dir);

    const cache = await factory<string>("pi", "v1");
    expect(cache.get("/a.jsonl", STAT_A)).toBeUndefined();
    cache.set("/a.jsonl", STAT_A, "fresh");
    await cache.save();

    const next = await factory<string>("pi", "v1");
    expect(next.get("/a.jsonl", STAT_A)).toBe("fresh");
  });
});

describe("collector integration", () => {
  function codexSession(outputTokens: string): string {
    // Both variants must have identical byte length so (mtime, size) matches.
    return [
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
          info: { last_token_usage: { input_tokens: 100, output_tokens: Number(outputTokens), total_tokens: 900 } },
        },
      }),
    ].join("\n");
  }

  it("reuses per-file results while stats are unchanged and reparses on change", async () => {
    const codexHome = await makeTempDir();
    const sessionsDir = join(codexHome, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const file = join(sessionsDir, "session.jsonl");
    const fixedTime = new Date(1_700_000_000_000);
    vi.stubEnv("CODEX_HOME", codexHome);

    const openScanCache = createScanCacheFactory(await makeTempDir());
    const options = { sources: ["codex" as const], openScanCache };

    await writeFile(file, codexSession("111"));
    await utimes(file, fixedTime, fixedTime);
    const cold = await collectUsageEntries(options);
    expect(cold.entries[0].outputTokens).toBe(111);

    // Same size, same mtime, different content → must come from the cache,
    // proving the file was not re-read.
    await writeFile(file, codexSession("222"));
    await utimes(file, fixedTime, fixedTime);
    const warm = await collectUsageEntries(options);
    expect(warm.entries[0].outputTokens).toBe(111);

    // Changed mtime → reparse picks up the new content.
    await utimes(file, new Date(1_800_000_000_000), new Date(1_800_000_000_000));
    const reparsed = await collectUsageEntries(options);
    expect(reparsed.entries[0].outputTokens).toBe(222);
  });

  it("reprices cached facts without re-reading unchanged logs", async () => {
    const codexHome = await makeTempDir();
    const sessionsDir = join(codexHome, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const file = join(sessionsDir, "session.jsonl");
    const fixedTime = new Date(1_700_000_000_000);
    vi.stubEnv("CODEX_HOME", codexHome);

    const openScanCache = createScanCacheFactory(await makeTempDir());
    await writeFile(file, codexSession("111"));
    await utimes(file, fixedTime, fixedTime);

    const priced = await collectUsageEntries({
      sources: ["codex"],
      openScanCache,
      calculateCost: () => 1,
    });
    expect(priced.entries[0].costUSD).toBe(1);

    // Same files, new pricing table → the cached token fact is reused and
    // receives the new price at collection time.
    const repriced = await collectUsageEntries({
      sources: ["codex"],
      openScanCache,
      calculateCost: () => 2,
    });
    expect(repriced.entries[0].costUSD).toBe(2);
  });
});
