import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { CCCLUB_CONFIG_DIR } from "@ccclub/shared";
import { getUsageCachePath, readLimitsLead } from "./statusline.js";
import type { LimitsLead, LiveLimit } from "./statusline.js";
import { getLimitsStatePath, readLimitsState } from "./usage-limits.js";
import type { LimitsState } from "./usage-limits.js";

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

// The sync above is the wrong tool for keeping the limits current: it scans
// every log and uploads, so its interval cannot come down without multiplying
// the server's KV bill for numbers nobody is waiting on. The limits need one
// request and nothing else. So there is a second, much lighter refresh, and it
// is driven by evidence rather than a clock: Claude Code tells every render
// what its session last saw, and a session that is *ahead of the cache* is
// proof the cache is out of date. No movement, no request — an idle machine
// asks nothing, and a busy one asks at most once a minute.
//
// What that buys over reading stdin alone: Fable's weekly limit, which is not
// in the payload, and every other open session, which only learns what this
// one spent through the cache.

/** Never refresh a cache younger than this, nor start two attempts closer together. */
export const LIMITS_MIN_AGE_MS = 60 * 1000;
/** Ceiling for the doubling wait between attempts that keep failing. */
export const LIMITS_MAX_BACKOFF_MS = 30 * 60 * 1000;
/** A Retry-After further out than this is not believed. */
const RETRY_AT_HORIZON_MS = 60 * 60 * 1000;
/** Sessions report one window's reset time to the second; allow for drift. */
const SAME_WINDOW_SLACK_MS = 60 * 1000;

/** When the last attempt was started, and the numbers it was started for. */
export interface LimitsAttempt {
  at: number;
  fiveHour: LiveLimit | null;
  sevenDay: LiveLimit | null;
}

export function getLimitsAttemptPath(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "limits-attempt.json");
}

function asLiveLimit(value: unknown): LiveLimit | null {
  const raw = value as Partial<LiveLimit> | null | undefined;
  return typeof raw?.percent === "number" && Number.isFinite(raw.percent) &&
    typeof raw?.resetsAt === "number" && Number.isFinite(raw.resetsAt)
    ? { percent: raw.percent, resetsAt: raw.resetsAt }
    : null;
}

function readLimitsAttempt(path: string): LimitsAttempt | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<LimitsAttempt> | null;
    if (typeof raw?.at !== "number" || !Number.isFinite(raw.at)) return null;
    return { at: raw.at, fiveHour: asLiveLimit(raw.fiveHour), sevenDay: asLiveLimit(raw.sevenDay) };
  } catch {
    return null; // never attempted from here
  }
}

/**
 * Whether a session's number is one no attempt has been made for yet: a later
 * window, or a higher (displayed) percentage inside the same one.
 */
function isNews(live: LiveLimit | null, asked: LiveLimit | null | undefined): live is LiveLimit {
  if (live == null) return false;
  if (asked == null) return true;
  if (live.resetsAt > asked.resetsAt + SAME_WINDOW_SLACK_MS) return true;
  if (live.resetsAt < asked.resetsAt - SAME_WINDOW_SLACK_MS) return false;
  return Math.round(live.percent) > Math.round(asked.percent);
}

/**
 * Whether this render should start a limits-only refresh. Pure, like
 * shouldTriggerRefresh.
 *
 * Being ahead of the cache is necessary but not sufficient. The request can
 * succeed and still leave the session ahead — the endpoint and the response
 * headers Claude Code reads need not agree to the point — and "ahead" alone
 * would then ask again every minute for as long as the session stays open.
 * So each attempt records the numbers it was made for, and only a number
 * beyond those earns another. A *failed* attempt is different: it is still
 * owed, and is retried on a doubling wait.
 */
export function shouldRefreshLimits(input: {
  lead: LimitsLead;
  attempt: LimitsAttempt | null;
  state: LimitsState;
  now: number;
}): boolean {
  const { lead, attempt, state, now } = input;
  if (lead.fiveHour == null && lead.sevenDay == null) return false;

  if (lead.cacheFetchedAt != null) {
    const age = now - lead.cacheFetchedAt;
    if (age >= 0 && age < LIMITS_MIN_AGE_MS) return false;
  }
  if (attempt != null) {
    const wait = Math.min(LIMITS_MIN_AGE_MS * 2 ** Math.min(state.failures, 10), LIMITS_MAX_BACKOFF_MS);
    const sinceAttempt = now - attempt.at;
    // As with the sync stamp: a future-dated attempt is not read as recent.
    if (sinceAttempt >= 0 && sinceAttempt < wait) return false;
  }
  if (state.retryAt != null && state.retryAt > now && state.retryAt - now <= RETRY_AT_HORIZON_MS) return false;

  if (state.failures > 0) return true;
  return isNews(lead.fiveHour, attempt?.fiveHour) || isNews(lead.sevenDay, attempt?.sevenDay);
}

/**
 * Start a detached limits refresh when this session has seen usage the cache
 * has not. Best effort and never throws, for the same reason as
 * maybeTriggerRefresh. Returns whether one was started.
 */
export function maybeRefreshLimits(options: {
  /** The stdin payload this render was given. */
  input: string;
  /** Absolute path to the limits bundle, resolved next to the caller's own file. */
  limitsCliPath: string;
  usageCachePath?: string;
  attemptPath?: string;
  statePath?: string;
  now?: number;
  platform?: NodeJS.Platform;
}): boolean {
  try {
    // The request reads Claude Code's token from the macOS keychain; anywhere
    // else it could only fail, once a minute, forever.
    if ((options.platform ?? process.platform) !== "darwin") return false;

    const now = options.now ?? Date.now();
    const lead = readLimitsLead(options.input, {
      now,
      usageCachePath: options.usageCachePath ?? getUsageCachePath(),
    });
    // The usual render ends here, having read nothing the renderer did not.
    if (lead.fiveHour == null && lead.sevenDay == null) return false;

    const attemptPath = options.attemptPath ?? getLimitsAttemptPath();
    const attempt = readLimitsAttempt(attemptPath);
    const state = readLimitsState(options.statePath ?? getLimitsStatePath());
    if (!shouldRefreshLimits({ lead, attempt, state, now })) return false;

    // Record before spawning, for the reason the sync stamp is written first.
    // A window this session is not ahead on keeps the number already asked for.
    const next: LimitsAttempt = {
      at: now,
      fiveHour: isNews(lead.fiveHour, attempt?.fiveHour) ? lead.fiveHour : attempt?.fiveHour ?? null,
      sevenDay: isNews(lead.sevenDay, attempt?.sevenDay) ? lead.sevenDay : attempt?.sevenDay ?? null,
    };
    const tmp = `${attemptPath}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(attemptPath), { recursive: true });
      writeFileSync(tmp, JSON.stringify(next));
      renameSync(tmp, attemptPath);
    } catch {
      // Unwritable — the refresh's own cache check (LIMITS_MIN_AGE_MS) still bounds this.
      try { rmSync(tmp, { force: true }); } catch { /* nothing to clean up */ }
    }

    spawn(process.execPath, [options.limitsCliPath], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return true;
  } catch {
    return false; // the line is already on stdout; nothing here may surface
  }
}
