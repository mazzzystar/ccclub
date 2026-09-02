import { mkdtemp, mkdir, readdir, rm, stat, writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach, vi } from "vitest";
import { createScanCacheFactory, mapWithConcurrency } from "../scan-cache.js";
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

  it("does not rewrite any shard of a fully hot cache", async () => {
    const dir = await makeTempDir();
    const factory = createScanCacheFactory(dir);

    const first = await factory<string>("claude", "parser=1");
    first.set("/a.jsonl", STAT_A, "parsed-a");
    await first.save();

    const fixedTime = new Date(1_700_000_000_000);
    const shardPaths = (await readdir(join(dir, "claude"))).map((name) => join(dir, "claude", name));
    for (const path of shardPaths) await utimes(path, fixedTime, fixedTime);

    const hot = await factory<string>("claude", "parser=1");
    expect(hot.get("/a.jsonl", STAT_A)).toBe("parsed-a");
    await hot.save();

    for (const path of shardPaths) {
      expect((await stat(path)).mtimeMs).toBe(fixedTime.getTime());
    }
  });

  it("rewrites only the dirty shard, never its unchanged neighbors", async () => {
    const dir = await makeTempDir();
    const factory = createScanCacheFactory(dir);

    const first = await factory<string>("codex", "v1");
    first.set("/stable.jsonl", STAT_A, "stable");
    first.set("/active.jsonl", STAT_A, "old");
    await first.save();

    const fixedTime = new Date(1_700_000_000_000);
    const shardPaths = (await readdir(join(dir, "codex")))
      .filter((name) => name !== "meta.json")
      .map((name) => join(dir, "codex", name));
    expect(shardPaths).toHaveLength(2);
    for (const path of shardPaths) await utimes(path, fixedTime, fixedTime);

    const second = await factory<string>("codex", "v1");
    expect(second.get("/stable.jsonl", STAT_A)).toBe("stable");
    expect(second.get("/active.jsonl", STAT_B)).toBeUndefined();
    second.set("/active.jsonl", STAT_B, "new");
    await second.save();

    const untouched = [];
    for (const path of shardPaths) {
      if ((await stat(path)).mtimeMs === fixedTime.getTime()) untouched.push(path);
    }
    expect(untouched).toHaveLength(1);

    const third = await factory<string>("codex", "v1");
    expect(third.get("/stable.jsonl", STAT_A)).toBe("stable");
    expect(third.get("/active.jsonl", STAT_B)).toBe("new");
  });

  it("treats a corrupt legacy cache file as cold and recovers on save", async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, "pi.json"), "{corrupt");
    const factory = createScanCacheFactory(dir);

    const cache = await factory<string>("pi", "v1");
    expect(cache.get("/a.jsonl", STAT_A)).toBeUndefined();
    cache.set("/a.jsonl", STAT_A, "fresh");
    await cache.save();

    const next = await factory<string>("pi", "v1");
    expect(next.get("/a.jsonl", STAT_A)).toBe("fresh");
    // The unusable single-file cache is cleaned up either way.
    await expect(stat(join(dir, "pi.json"))).rejects.toThrow();
  });

  it("migrates a v2 single-file cache into shards without reparsing", async () => {
    const dir = await makeTempDir();
    const legacy = {
      version: 2,
      metaToken: "parser=5",
      files: {
        "/sessions/a.jsonl": { mtimeMs: STAT_A.mtimeMs, size: STAT_A.size, data: "fact-a" },
        "/sessions/b.jsonl": { mtimeMs: STAT_B.mtimeMs, size: STAT_B.size, data: "fact-b" },
      },
    };
    await writeFile(join(dir, "codex.json"), JSON.stringify(legacy));
    const factory = createScanCacheFactory(dir);

    const migrated = await factory<string>("codex", "parser=5");
    // Warm hits straight out of the legacy payload — no reparse needed.
    expect(migrated.get("/sessions/a.jsonl", STAT_A)).toBe("fact-a");
    expect(migrated.get("/sessions/b.jsonl", STAT_B)).toBe("fact-b");
    await migrated.save();

    // The monolith is gone and both entries survived as shards.
    await expect(stat(join(dir, "codex.json"))).rejects.toThrow();
    const shards = (await readdir(join(dir, "codex"))).filter((name) => name !== "meta.json");
    expect(shards).toHaveLength(2);

    const reopened = await factory<string>("codex", "parser=5");
    expect(reopened.get("/sessions/a.jsonl", STAT_A)).toBe("fact-a");
    expect(reopened.get("/sessions/b.jsonl", STAT_B)).toBe("fact-b");
  });

  it("imports predecessor shards through the converter instead of rescanning", async () => {
    const dir = await makeTempDir();
    const factory = createScanCacheFactory(dir);

    const old = await factory<string>("codex", "parser=5");
    old.set("/a.jsonl", STAT_A, "raw-a");
    old.set("/b.jsonl", STAT_B, "raw-b");
    await old.save();

    const importFrom = { metaToken: "parser=5", convert: (d: unknown) => `packed:${d}` };
    const upgraded = await factory<string>("codex", "parser=6", importFrom);
    expect(upgraded.get("/a.jsonl", STAT_A)).toBe("packed:raw-a");
    expect(upgraded.get("/b.jsonl", STAT_B)).toBe("packed:raw-b");
    await upgraded.save();

    // The migration persisted: a plain v6 open now hits without the bridge.
    const settled = await factory<string>("codex", "parser=6");
    expect(settled.get("/a.jsonl", STAT_A)).toBe("packed:raw-a");
    expect(settled.get("/b.jsonl", STAT_B)).toBe("packed:raw-b");
  });

  it("drops only the records the import converter rejects", async () => {
    const dir = await makeTempDir();
    const factory = createScanCacheFactory(dir);

    const old = await factory<string>("codex", "parser=5");
    old.set("/good.jsonl", STAT_A, "fine");
    old.set("/bad.jsonl", STAT_A, "broken");
    await old.save();

    const importFrom = {
      metaToken: "parser=5",
      convert: (d: unknown) => (d === "broken" ? null : `packed:${d}`),
    };
    const upgraded = await factory<string>("codex", "parser=6", importFrom);
    expect(upgraded.get("/good.jsonl", STAT_A)).toBe("packed:fine");
    expect(upgraded.get("/bad.jsonl", STAT_A)).toBeUndefined();
  });

  it("imports a v2 monolith written by the importable predecessor", async () => {
    const dir = await makeTempDir();
    const legacy = {
      version: 2,
      metaToken: "parser=5",
      files: { "/a.jsonl": { mtimeMs: STAT_A.mtimeMs, size: STAT_A.size, data: "raw-a" } },
    };
    await writeFile(join(dir, "codex.json"), JSON.stringify(legacy));
    const factory = createScanCacheFactory(dir);

    const importFrom = { metaToken: "parser=5", convert: (d: unknown) => `packed:${d}` };
    const cache = await factory<string>("codex", "parser=6", importFrom);
    expect(cache.get("/a.jsonl", STAT_A)).toBe("packed:raw-a");
    await cache.save();
    await expect(stat(join(dir, "codex.json"))).rejects.toThrow();
  });

  it("sweeps write-temps left behind by dead processes", async () => {
    const dir = await makeTempDir();
    const factory = createScanCacheFactory(dir);

    const first = await factory<string>("pi", "v1");
    first.set("/a.jsonl", STAT_A, "parsed");
    await first.save();
    await writeFile(join(dir, "pi", "abc123.json.999.tmp"), "{orphaned");

    const second = await factory<string>("pi", "v1");
    expect(second.get("/a.jsonl", STAT_A)).toBe("parsed");
    await second.save();

    const names = await readdir(join(dir, "pi"));
    expect(names.some((name) => name.endsWith(".tmp"))).toBe(false);
    expect(second.get("/a.jsonl", STAT_A)).toBe("parsed");
  });

  it("ignores a legacy cache whose meta token no longer matches", async () => {
    const dir = await makeTempDir();
    const legacy = {
      version: 2,
      metaToken: "parser=4",
      files: { "/sessions/a.jsonl": { mtimeMs: STAT_A.mtimeMs, size: STAT_A.size, data: "stale" } },
    };
    await writeFile(join(dir, "codex.json"), JSON.stringify(legacy));
    const factory = createScanCacheFactory(dir);

    const cache = await factory<string>("codex", "parser=5");
    expect(cache.get("/sessions/a.jsonl", STAT_A)).toBeUndefined();
    cache.set("/sessions/a.jsonl", STAT_A, "fresh");
    await cache.save();

    const next = await factory<string>("codex", "parser=5");
    expect(next.get("/sessions/a.jsonl", STAT_A)).toBe("fresh");
    await expect(stat(join(dir, "codex.json"))).rejects.toThrow();
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

describe("mapWithConcurrency", () => {
  it("keeps results at their input index and never exceeds the limit", async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    let inFlight = 0;
    let peak = 0;

    const results = await mapWithConcurrency(items, 16, async (item) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      // Finishing out of input order is the whole point of the check below.
      await new Promise((resolve) => setTimeout(resolve, item % 7));
      inFlight--;
      return `item-${item}`;
    });

    expect(results).toEqual(items.map((item) => `item-${item}`));
    expect(peak).toBe(16);
  });

  it("handles fewer items than the limit, and none at all", async () => {
    expect(await mapWithConcurrency([1, 2], 16, async (n) => n * 2)).toEqual([2, 4]);
    expect(await mapWithConcurrency([] as number[], 16, async (n) => n)).toEqual([]);
  });
});

describe("shard loading", () => {
  it("recovers every record when there are more shards than the read limit", async () => {
    const dir = await makeTempDir();
    const files = Array.from({ length: 40 }, (_, i) => `/session-${i}.jsonl`);

    const writer = await createScanCacheFactory(dir)<string>("codex", "v1");
    for (const file of files) writer.set(file, STAT_A, `parsed${file}`);
    await writer.save();

    const reader = await createScanCacheFactory(dir)<string>("codex", "v1");
    expect(files.map((file) => reader.get(file, STAT_A))).toEqual(
      files.map((file) => `parsed${file}`),
    );
  });
});
