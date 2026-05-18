import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { glob } from "glob";

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
  return groups.flat().sort();
}

export async function readJsonFile(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as unknown;
  } catch {
    return null;
  }
}

export async function readJsonlFile(
  file: string,
  onValue: (value: unknown, line: string) => void | Promise<void>,
): Promise<void> {
  const stream = createReadStream(file, { encoding: "utf-8" });
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

export function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}
