import { readFile, writeFile, mkdir, rename, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { CCCLUB_CONFIG_DIR } from "@ccclub/shared";

// Per-file scan cache: sync used to stream every agent log on every run,
// which grows unbounded with history (multi-GB on long-lived machines).
// Log files are immutable once a session ends, so each collector caches its
// per-file parse results keyed by (mtime, size) and only re-reads files that
// changed. Cross-file work (dedup, aggregation) still runs on every sync.
//
// v3 shards the cache into one JSON file per source log file. The previous
// single-file layout hit V8's ~512 MiB string ceiling on heavy Codex users:
// JSON.stringify of the whole payload threw RangeError, save() swallowed it,
// and the frozen cache silently degraded every sync into a multi-minute
// rescan of all history. Shards keep every string file-sized, rewrite only
// what changed, and can never lose the whole cache to one oversized payload.
const CACHE_FORMAT_VERSION = 3;
const LEGACY_FORMAT_VERSION = 2;

export interface FileStat {
  mtimeMs: number;
  size: number;
}

export interface SourceFileCache<T> {
  /** Cached parse result, or undefined when the file changed or is unknown. */
  get(file: string, stat: FileStat): T | undefined;
  set(file: string, stat: FileStat, data: T): void;
  /** Persist everything seen this run; files gone from disk fall out naturally. */
  save(): Promise<void>;
}

/**
 * Lossless upgrade path from one cached shape to its successor. When the disk
 * holds `metaToken`'s data instead of the requested token, every record is
 * offered to `convert`; a non-null result is used as a warm entry and written
 * back in the new shape at save. Returning null drops just that record, so a
 * malformed survivor costs one reparse instead of the whole cache.
 */
export interface ScanCacheImport<T> {
  metaToken: string;
  convert: (data: unknown) => T | null;
}

/**
 * Opens the cache for one source. `metaToken` captures every input that
 * influences parse results besides file content (pricing table version,
 * Codex service tier, …) — when it changes, the whole cache is discarded,
 * unless the collector supplies an `importFrom` bridge for the old token.
 */
export type ScanCacheFactory = <T>(
  source: string,
  metaToken: string,
  importFrom?: ScanCacheImport<T>,
) => Promise<SourceFileCache<T>>;

interface ShardShape {
  file: string;
  mtimeMs: number;
  size: number;
  data: unknown;
}

interface LegacyCacheShape {
  version: number;
  metaToken: string;
  files: Record<string, { mtimeMs: number; size: number; data: unknown }>;
}

export function getScanCacheDir(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "scan-cache");
}

function shardName(file: string): string {
  return createHash("sha256").update(file).digest("hex").slice(0, 20) + ".json";
}

// Shards are loaded a few at a time rather than all at once. A heavy Codex
// user has 467 of them holding 217 MB of JSON, and reading every one in
// parallel meant every buffer, every intermediate string and every parsed
// object was live at the same moment: 590 MB of heap for a load that needs
// far less. Sixteen in flight costs +60 ms and holds 260 MB less — worth it
// on an 8 GB Mac, where the default heap is 2 GB.
const SHARD_READ_CONCURRENCY = 16;

/**
 * @internal Exported for tests. Results land at their input index, so the
 * caller never sees an order that depends on which read finished first.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function readShards(sourceDir: string): Promise<{
  records: Map<string, ShardShape>;
  diskNames: Set<string>;
  staleTempNames: string[];
}> {
  const records = new Map<string, ShardShape>();
  const diskNames = new Set<string>();
  const staleTempNames: string[] = [];
  let names: string[];
  try {
    names = await readdir(sourceDir);
  } catch {
    return { records, diskNames, staleTempNames };
  }
  const shardFiles: string[] = [];
  for (const name of names) {
    if (name === "meta.json") continue;
    if (name.endsWith(".json")) shardFiles.push(name);
    // A .tmp here is a write a dead process never renamed; left alone they
    // accumulate forever. A live concurrent writer can lose one to this
    // sweep, which only costs that file a reparse on its next run.
    else if (name.endsWith(".tmp")) staleTempNames.push(name);
  }
  for (const name of shardFiles) diskNames.add(name);
  const loaded = await mapWithConcurrency(shardFiles, SHARD_READ_CONCURRENCY, async (name) => {
    try {
      const rec = JSON.parse(await readFile(join(sourceDir, name), "utf-8")) as ShardShape;
      return rec != null && typeof rec.file === "string" && typeof rec.mtimeMs === "number" ? rec : null;
    } catch {
      // Corrupt shard — its file parses cold this run and the shard is
      // rewritten or pruned at save.
      return null;
    }
  });
  for (const rec of loaded) {
    if (rec != null) records.set(rec.file, rec);
  }
  return { records, diskNames, staleTempNames };
}

async function readMetaToken(sourceDir: string): Promise<string | null> {
  try {
    const meta = JSON.parse(await readFile(join(sourceDir, "meta.json"), "utf-8")) as {
      version?: number;
      metaToken?: string;
    };
    return meta?.version === CACHE_FORMAT_VERSION && typeof meta.metaToken === "string"
      ? meta.metaToken
      : null;
  } catch {
    return null;
  }
}

/** One-time import of the pre-v3 single-file cache so upgrades keep history warm. */
async function readLegacyFiles(
  legacyPath: string,
  acceptTokens: Map<string, (data: unknown) => unknown | null>,
): Promise<LegacyCacheShape["files"] | null> {
  try {
    const raw = JSON.parse(await readFile(legacyPath, "utf-8")) as LegacyCacheShape;
    const convert = raw != null && raw.version === LEGACY_FORMAT_VERSION
      ? acceptTokens.get(raw.metaToken)
      : undefined;
    if (convert != null && raw.files != null && typeof raw.files === "object") {
      const files: LegacyCacheShape["files"] = {};
      for (const [file, rec] of Object.entries(raw.files)) {
        const data = convert(rec.data);
        if (data != null) files[file] = { mtimeMs: rec.mtimeMs, size: rec.size, data };
      }
      return files;
    }
  } catch {
    // Unreadable (including caches that outgrew the string ceiling) — parse cold.
  }
  return null;
}

async function writeShard(sourceDir: string, name: string, payload: unknown): Promise<void> {
  // Write-then-rename: concurrent hook and heartbeat syncs never see a torn file.
  const tempPath = join(sourceDir, `${name}.${process.pid}.tmp`);
  await writeFile(tempPath, JSON.stringify(payload));
  await rename(tempPath, join(sourceDir, name));
}

export function createScanCacheFactory(dir = getScanCacheDir()): ScanCacheFactory {
  return async <T>(
    source: string,
    metaToken: string,
    importFrom?: ScanCacheImport<T>,
  ): Promise<SourceFileCache<T>> => {
    const sourceDir = join(dir, source);
    const legacyPath = join(dir, `${source}.json`);
    // Tokens this open can make use of: the current one as-is, and the
    // importable predecessor through its converter.
    const acceptTokens = new Map<string, (data: unknown) => unknown | null>([
      [metaToken, (data) => data],
    ]);
    if (importFrom != null) acceptTokens.set(importFrom.metaToken, importFrom.convert);

    const diskToken = await readMetaToken(sourceDir);
    const metaUsable = diskToken === metaToken;
    let previous = new Map<string, ShardShape>();
    let diskNames = new Set<string>();
    let staleTempNames: string[] = [];
    let migrating = false;

    if (metaUsable) {
      ({ records: previous, diskNames, staleTempNames } = await readShards(sourceDir));
    } else if (diskToken != null && importFrom != null && diskToken === importFrom.metaToken) {
      // Predecessor shards: convert each record in place of a cold rescan.
      ({ records: previous, diskNames, staleTempNames } = await readShards(sourceDir));
      const converted = new Map<string, ShardShape>();
      for (const [file, rec] of previous) {
        const data = importFrom.convert(rec.data);
        if (data != null) converted.set(file, { ...rec, data });
      }
      previous = converted;
      migrating = true;
    } else if (diskToken == null) {
      // No v3 cache yet — import the legacy single-file layout when possible.
      const legacy = await readLegacyFiles(legacyPath, acceptTokens);
      if (legacy != null) {
        for (const [file, rec] of Object.entries(legacy)) {
          previous.set(file, { file, mtimeMs: rec.mtimeMs, size: rec.size, data: rec.data });
        }
        migrating = true;
      }
    } else {
      // Token changed with no bridge: stale shards are pruned at save, after
      // the fresh entries have been written.
      ({ diskNames, staleTempNames } = await readShards(sourceDir));
      previous = new Map();
    }

    const next = new Map<string, ShardShape>();
    const dirtyFiles = new Set<string>();

    return {
      get(file, stat) {
        const hit = previous.get(file);
        if (hit == null || hit.mtimeMs !== stat.mtimeMs || hit.size !== stat.size) return undefined;
        next.set(file, hit);
        return hit.data as T;
      },
      set(file, stat, data) {
        next.set(file, { file, mtimeMs: stat.mtimeMs, size: stat.size, data });
        dirtyFiles.add(file);
      },
      async save() {
        try {
          // Sweep write-temps orphaned by dead processes even on a hot run.
          await Promise.all(staleTempNames.map(async (name) => {
            try {
              await unlink(join(sourceDir, name));
            } catch { /* already gone */ }
          }));

          // A fully hot scan touched every previous file and parsed nothing —
          // leave the shards byte-for-byte alone.
          if (metaUsable && !migrating && dirtyFiles.size === 0 && next.size === previous.size) {
            return;
          }
          await mkdir(sourceDir, { recursive: true });
          if (!metaUsable) {
            await writeShard(sourceDir, "meta.json", { version: CACHE_FORMAT_VERSION, metaToken });
          }

          // Migration must materialize every carried-over entry; normal runs
          // rewrite only what was actually reparsed.
          const filesToWrite = migrating ? [...next.keys()] : [...dirtyFiles].filter((file) => next.has(file));
          await Promise.all(filesToWrite.map(async (file) => {
            const rec = next.get(file)!;
            try {
              await writeShard(sourceDir, shardName(file), rec);
            } catch {
              // One oversized or unwritable shard only costs that file a
              // reparse next run — it can no longer take the cache with it.
            }
          }));

          // Entries for deleted files are pruned without explicit bookkeeping.
          const expected = new Set([...next.keys()].map(shardName));
          await Promise.all([...diskNames].filter((name) => !expected.has(name)).map(async (name) => {
            try {
              await unlink(join(sourceDir, name));
            } catch { /* already gone */ }
          }));

          // The legacy single file is superseded either way; reclaim its
          // hundreds of megabytes once the sharded layout exists.
          try {
            await unlink(legacyPath);
          } catch { /* never existed */ }
        } catch {
          // The cache is purely an optimization — never let it break a sync.
        }
      },
    };
  };
}
