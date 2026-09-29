import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { glob } from "glob";
import { AGENT_LABELS } from "@ccclub/shared";
import type { AgentSource } from "@ccclub/shared";

export function resolveHomePath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function parsePathList(value: string | undefined, fallback: string[]): string[] {
  const raw = value?.trim()
    ? value.split(",").map((p) => p.trim()).filter(Boolean)
    : fallback;
  return Array.from(new Set(raw.map((p) => resolve(resolveHomePath(p)))));
}

export async function statFile(path: string): Promise<{ mtimeMs: number; size: number } | null> {
  try {
    const info = await stat(path);
    return { mtimeMs: info.mtimeMs, size: info.size };
  } catch {
    return null;
  }
}

/** How many offending paths one warning names before it just counts the rest. */
const UNREADABLE_SAMPLE = 3;

/**
 * Files a collector globbed but could not stat. The usual cause is a dangling
 * symlink — Claude Code removes a session directory and leaves the
 * `subagents/*.jsonl` links pointing at nothing — or a log rotated away in the
 * moment between the glob and the stat. `globFiles` returns those paths
 * happily, and opening one throws ENOENT; an exception escaping a collector
 * costs the ENTIRE source (collectAllUsageEntries turns it into an empty
 * result), so they are skipped instead. Skipping in silence is how a source
 * loses files with nobody the wiser, hence the warning.
 */
export function unreadableFilesWarnings(source: AgentSource, paths: string[]): string[] {
  if (paths.length === 0) return [];
  const shown = paths.slice(0, UNREADABLE_SAMPLE);
  const rest = paths.length - shown.length;
  return [
    `${AGENT_LABELS[source]}: skipped ${paths.length} unreadable file${paths.length === 1 ? "" : "s"}` +
      ` (deleted, or a symlink pointing at nothing): ${shown.join(", ")}` +
      `${rest > 0 ? `, and ${rest} more` : ""}`,
  ];
}

export async function existingDirectories(paths: string[]): Promise<string[]> {
  const results = await Promise.all(
    paths.map(async (path) => {
      try {
        return (await stat(path)).isDirectory() ? path : null;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((path): path is string => path !== null);
}

export async function globFiles(directories: string[], pattern: string): Promise<string[]> {
  const groups = await Promise.all(
    directories.map((cwd) => glob(pattern, { cwd, absolute: true }).catch(() => [])),
  );
  // Roots nest: with CLAUDE_CONFIG_DIR set, both <dir>/projects and <dir> are
  // offered as roots, so `**/*.jsonl` matches every log twice and the whole
  // corpus is read, parsed and cached twice. Dedup collapses the two matches
  // to one absolute path — dedup downstream already made the second pass
  // produce nothing but cost.
  return Array.from(new Set(groups.flat())).sort();
}

export async function readJsonFile(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as unknown;
  } catch {
    return null;
  }
}

/**
 * Stream one JSONL log, handing every parsable row to `onValue`. Answers the
 * error that ended the read early, or null for a clean pass to EOF — it never
 * throws, because one unreadable file must not cost a source every OTHER
 * file's usage, which is exactly what the source-level catch in
 * collectAllUsageEntries does with an escaping exception.
 *
 * Reads fail for ordinary reasons: the log is deleted between the stat and the
 * read (Claude Code prunes session directories while it works), a directory
 * carries a `.jsonl` name (EISDIR, and the glob returns it), or the file is
 * simply not readable (EACCES). Each yields the rows read so far plus an error
 * for the caller to surface as a warning.
 */
export async function readJsonlFile(
  file: string,
  onValue: (value: unknown, line: string) => void | Promise<void>,
): Promise<Error | null> {
  let stream: ReturnType<typeof createReadStream> | undefined;
  try {
    stream = createReadStream(file, { encoding: "utf-8" });
    const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        await onValue(JSON.parse(trimmed) as unknown, trimmed);
      } catch {
        // Ignore malformed JSONL rows. These are local tool logs and can be partially written.
      }
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  } finally {
    // A read that ended early leaves the handle open.
    stream?.destroy();
  }
}

/**
 * A file that existed at stat time and still could not be read through. The
 * rows collected before the failure are kept — half a log beats none — so the
 * warning says the file may be short rather than missing.
 */
export function readFailureWarning(source: AgentSource, path: string, error: Error): string {
  return `${AGENT_LABELS[source]}: could not finish reading ${path} (${error.message}); its usage may be incomplete`;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

// The canonical ISO form Date#toISOString emits while the year fits four
// digits: exactly `YYYY-MM-DDTHH:mm:ss.sssZ`, 24 characters, fixed width.
const MIN_CANONICAL_MS = -62_167_219_200_000; // 0000-01-01T00:00:00.000Z
const MAX_CANONICAL_MS = 253_402_300_799_999; // 9999-12-31T23:59:59.999Z

/**
 * Every entry and turn timestamp the CLI produces is minted here, and the
 * sorts downstream lean on that: fixed-width canonical ISO strings compare
 * lexically exactly the way they compare chronologically. Outside the
 * four-digit-year range Date switches to its extended form
 * (`+055840-11-08T22:13:20.000Z`), whose leading `+` sorts before every real
 * timestamp — one such value would reorder the whole corpus around it. A log
 * carrying microseconds where milliseconds were expected is enough to mint
 * one, so those values are rejected at the source instead of being left to
 * corrupt the ordering of everything else.
 */
function canonicalIso(ms: number): string | null {
  return ms >= MIN_CANONICAL_MS && ms <= MAX_CANONICAL_MS ? new Date(ms).toISOString() : null;
}

/**
 * Chronological order for anything carrying a timestamp minted by
 * `toIsoTimestamp`. Canonical ISO is fixed-width, so lexical order is
 * chronological order, and skipping the date parse is worth roughly an order
 * of magnitude: 401 ms to sort a 320k-entry corpus becomes 35 ms.
 */
export function byTimestamp(a: { timestamp: string }, b: { timestamp: string }): number {
  return a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0;
}

export function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === "string") {
    // NaN fails both comparisons, so an unparsable date returns null.
    return canonicalIso(new Date(value).getTime());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return canonicalIso(value < 10_000_000_000 ? value * 1000 : value);
  }

  return null;
}
