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
 * Opens the cache for one source. `metaToken` captures every input that
 * influences parse results besides file content (pricing table version,
 * Codex service tier, …) — when it changes, the whole cache is discarded.
 */
export type ScanCacheFactory = <T>(source: string, metaToken: string) => Promise<SourceFileCache<T>>;

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

async function readShards(sourceDir: string): Promise<{ records: Map<string, ShardShape>; diskNames: Set<string> }> {
  const records = new Map<string, ShardShape>();
  const diskNames = new Set<string>();
  let names: string[];
  try {
    names = await readdir(sourceDir);
  } catch {
    return { records, diskNames };
  }
  const shardFiles = names.filter((name) => name !== "meta.json" && name.endsWith(".json"));
  await Promise.all(shardFiles.map(async (name) => {
    diskNames.add(name);
    try {
      const rec = JSON.parse(await readFile(join(sourceDir, name), "utf-8")) as ShardShape;
      if (rec != null && typeof rec.file === "string" && typeof rec.mtimeMs === "number") {
        records.set(rec.file, rec);
      }
    } catch {
      // Corrupt shard — its file parses cold this run and the shard is
      // rewritten or pruned at save.
    }
  }));
  return { records, diskNames };
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
async function readLegacyFiles(legacyPath: string, metaToken: string): Promise<LegacyCacheShape["files"] | null> {
  try {
    const raw = JSON.parse(await readFile(legacyPath, "utf-8")) as LegacyCacheShape;
    if (
      raw != null &&
      raw.version === LEGACY_FORMAT_VERSION &&
      raw.metaToken === metaToken &&
      raw.files != null &&
      typeof raw.files === "object"
    ) {
      return raw.files;
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
  return async <T>(source: string, metaToken: string): Promise<SourceFileCache<T>> => {
    const sourceDir = join(dir, source);
    const legacyPath = join(dir, `${source}.json`);

    const diskToken = await readMetaToken(sourceDir);
    const metaUsable = diskToken === metaToken;
    let previous = new Map<string, ShardShape>();
    let diskNames = new Set<string>();
    let migrating = false;

    if (metaUsable) {
      ({ records: previous, diskNames } = await readShards(sourceDir));
    } else if (diskToken == null) {
      // No v3 cache yet — import the legacy single-file layout when possible.
      const legacy = await readLegacyFiles(legacyPath, metaToken);
      if (legacy != null) {
        for (const [file, rec] of Object.entries(legacy)) {
          previous.set(file, { file, mtimeMs: rec.mtimeMs, size: rec.size, data: rec.data });
        }
        migrating = true;
      }
    } else {
      // Token changed: stale shards are pruned at save, after the fresh
      // entries have been written.
      ({ diskNames } = await readShards(sourceDir));
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
