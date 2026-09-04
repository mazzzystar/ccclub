import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { CCCLUB_CONFIG_DIR } from "@ccclub/shared";
import { getUsageCachePath } from "./statusline.js";

// Only `ccclub sync` refreshes the usage cache, and both of its triggers stop
// while the machine is asleep: the Stop hook needs a turn to end, and the
// heartbeat LaunchAgent's 5-minute StartInterval is suppressed (measured on
// this machine: ~40 minutes effective, and 8-hour gaps across a night). The
// statusline is the one thing that definitely runs the moment the user comes
// back, so it kicks off the sync itself — after the line is already printed,
// so nothing here is on the render path.

/** Refresh once the usage cache is older than this. */
export const REFRESH_MIN_AGE_MS = 10 * 60 * 1000;
/** …and never more often than this, however those syncs turn out. */
export const REFRESH_DEBOUNCE_MS = 5 * 60 * 1000;

/** mtime-only marker: when this statusline last started a sync. */
export function getRefreshStampPath(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "statusline-refresh");
}

/**
 * Whether this render should start a background sync. Pure — the caller reads
 * both timestamps — so the policy is testable without spawning anything.
 *
 * The debounce is what keeps an offline machine cheap: a failed sync leaves
 * the cache exactly as stale, so the age test alone would spawn a process
 * every single turn. A future-dated stamp (clock moved backwards) is not read
 * as recent; the next spawn rewrites it and the machine heals itself.
 */
export function shouldTriggerRefresh(input: {
  usageFetchedAt: number | null;
  lastSpawnAt: number | null;
  now: number;
}): boolean {
  const { usageFetchedAt, lastSpawnAt, now } = input;
  if (lastSpawnAt != null) {
    const sinceSpawn = now - lastSpawnAt;
    if (sinceSpawn >= 0 && sinceSpawn < REFRESH_DEBOUNCE_MS) return false;
  }
  // Missing, unreadable, or future-dated: all cases the render path cannot use
  // either, and all fixed by the same sync.
  if (usageFetchedAt == null) return true;
  const age = now - usageFetchedAt;
  return !(age >= 0 && age <= REFRESH_MIN_AGE_MS);
}

function readUsageFetchedAt(path: string): number | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as { fetchedAt?: unknown };
    return typeof raw?.fetchedAt === "number" && Number.isFinite(raw.fetchedAt) ? raw.fetchedAt : null;
  } catch {
    return null; // no cache yet, or one the renderer could not use either
  }
}

function readStampedAt(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null; // never spawned from here
  }
}

/**
 * Start a detached `ccclub sync --silent` when the usage cache has gone stale.
 * Best effort: never throws, so the printed line and the exit code cannot
 * depend on it. Returns whether a sync was started.
 *
 * The spawned sync takes the same cross-process lock and 5-minute throttle as
 * every other caller, so a hook sync already in flight simply wins.
 */
export function maybeTriggerRefresh(options: {
  /** Absolute path to the CLI bundle, resolved next to the caller's own file. */
  cliPath: string;
  usageCachePath?: string;
  stampPath?: string;
  now?: number;
}): boolean {
  try {
    const stampPath = options.stampPath ?? getRefreshStampPath();
    const trigger = shouldTriggerRefresh({
      usageFetchedAt: readUsageFetchedAt(options.usageCachePath ?? getUsageCachePath()),
      lastSpawnAt: readStampedAt(stampPath),
      now: options.now ?? Date.now(),
    });
    if (!trigger) return false;

    // Stamp before spawning: an attempt that dies on startup must still cost
    // the debounce, or a machine that cannot spawn would try every turn.
    try {
      mkdirSync(dirname(stampPath), { recursive: true });
      writeFileSync(stampPath, "");
    } catch {
      // Unwritable stamp — the sync's own throttle and lock still bound this.
    }

    // node with an absolute path, not npx and not PATH: npx would pay a
    // registry round-trip on every wake, and the statusline runs with whatever
    // environment Claude Code was launched from, which need not have ccclub on
    // its PATH at all.
    spawn(process.execPath, [options.cliPath, "sync", "--silent"], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return true;
  } catch {
    return false; // the line is already on stdout; nothing here may surface
  }
}
