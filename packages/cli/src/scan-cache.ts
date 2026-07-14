import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { CCCLUB_CONFIG_DIR } from "@ccclub/shared";

// Per-file scan cache: sync used to stream every agent log on every run,
// which grows unbounded with history (multi-GB on long-lived machines).
// Log files are immutable once a session ends, so each collector caches its
// per-file parse results keyed by (mtime, size) and only re-reads files that
// changed. Cross-file work (dedup, aggregation) still runs on every sync.

// v2 stores pricing-independent usage facts. Old files are discarded once and
// rebuilt from source logs; subsequent pricing changes no longer invalidate it.
const CACHE_FORMAT_VERSION = 2;

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

interface CacheFileShape {
  version: number;
  metaToken: string;
  files: Record<string, { mtimeMs: number; size: number; data: unknown }>;
}

export function getScanCacheDir(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "scan-cache");
}

export function createScanCacheFactory(dir = getScanCacheDir()): ScanCacheFactory {
  return async <T>(source: string, metaToken: string): Promise<SourceFileCache<T>> => {
    const path = join(dir, `${source}.json`);

    let previous: CacheFileShape["files"] = {};
    let cacheWasUsable = false;
    try {
      const raw = JSON.parse(await readFile(path, "utf-8")) as CacheFileShape;
      if (
        raw != null &&
        raw.version === CACHE_FORMAT_VERSION &&
        raw.metaToken === metaToken &&
        raw.files != null &&
        typeof raw.files === "object"
      ) {
        previous = raw.files;
        cacheWasUsable = true;
      }
    } catch {
      // Missing or corrupt cache — every file parses cold this run.
    }

    // Only files touched this run are written back, so entries for deleted
    // files are pruned without any explicit bookkeeping.
    const next: CacheFileShape["files"] = {};
    let dirty = false;

    return {
      get(file, stat) {
        const hit = previous[file];
        if (hit == null || hit.mtimeMs !== stat.mtimeMs || hit.size !== stat.size) return undefined;
        next[file] = hit;
        return hit.data as T;
      },
      set(file, stat, data) {
        next[file] = { mtimeMs: stat.mtimeMs, size: stat.size, data };
        dirty = true;
      },
      async save() {
        try {
          // A fully hot scan touched every previous file and parsed nothing.
          // Preserve the existing file byte-for-byte instead of rewriting a
          // tens-of-megabytes JSON cache every five minutes.
          if (
            cacheWasUsable &&
            !dirty &&
            Object.keys(next).length === Object.keys(previous).length
          ) {
            return;
          }
          await mkdir(dir, { recursive: true });
          const payload: CacheFileShape = { version: CACHE_FORMAT_VERSION, metaToken, files: next };
          // Write-then-rename: concurrent hook and heartbeat syncs never see a torn file.
          const tempPath = join(dir, `${source}.json.${process.pid}.tmp`);
          await writeFile(tempPath, JSON.stringify(payload));
          await rename(tempPath, path);
        } catch {
          // The cache is purely an optimization — never let it break a sync.
        }
      },
    };
  };
}
