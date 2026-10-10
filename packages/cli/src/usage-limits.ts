import { execFileSync } from "node:child_process";
import { userInfo, homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, renameSync, rmSync, lstatSync } from "node:fs";
import { CCCLUB_CONFIG_DIR } from "@ccclub/shared";
import type { UsageSnapshot } from "@ccclub/shared";
import { appendCappedLog } from "./fs-utils.js";
import { getModelWeeklyPath, USAGE_MAX_AGE_MS } from "./statusline.js";
import type { ModelWeekly } from "./statusline.js";

export type { UsageSnapshot };

const debug = (...args: unknown[]) => {
  if (process.env.CCCLUB_DEBUG) console.error("[usage-debug]", ...args);
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_PATH = join(homedir(), CCCLUB_CONFIG_DIR, "usage-cache.json");

interface StoredUsageCache {
  snapshot: UsageSnapshot;
  fetchedAt: number;
}

function readStoredCache(): StoredUsageCache | null {
  try {
    const raw = JSON.parse(readFileSync(CACHE_PATH, "utf-8")) as StoredUsageCache;
    if (raw?.snapshot == null || typeof raw.fetchedAt !== "number" || !isFinite(raw.fetchedAt)) return null;
    return raw;
  } catch {
    return null; // no cache or parse error
  }
}

function readCache(maxAgeMs: number): UsageSnapshot | null {
  const stored = readStoredCache();
  if (stored == null) return null;
  const age = Date.now() - stored.fetchedAt;
  // A future-dated timestamp would otherwise count as fresh forever.
  if (age >= 0 && age < maxAgeMs) return stored.snapshot;
  return null;
}

function writeCache(snapshot: UsageSnapshot, fetchedAt = Date.now()): void {
  // Rename-swap: the statusline reads this file on every turn, and a plain
  // write truncates first, so a read could land on an empty file.
  const tmp = `${CACHE_PATH}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify({ snapshot, fetchedAt }));
    renameSync(tmp, CACHE_PATH);
  } catch {
    try { rmSync(tmp, { force: true }); } catch { /* nothing to clean up */ }
  }
}

function parseUtilization(value: unknown): number {
  if (typeof value === "number") return Math.round(value * 100) / 100;
  if (typeof value === "string") {
    const n = parseFloat(value.replace("%", ""));
    return isNaN(n) ? 0 : Math.round(n * 100) / 100;
  }
  return 0;
}

/**
 * What a usage response says about the model-scoped weekly limit. "none" and
 * "unknown" are deliberately distinct: an array with no scoped entry means the
 * limit genuinely does not apply, whereas an entry we cannot read means the
 * payload drifted and says nothing — overwriting on that would throw away a
 * good value over a cosmetic schema change.
 */
type ScopedLimit =
  | { state: "found"; limit: ModelWeekly }
  | { state: "none" }
  | { state: "unknown" };

/** The API is loose about numeric types (see parseUtilization), so accept both. */
function parsePercent(value: unknown): number | null {
  const n = typeof value === "number" ? value
    : typeof value === "string" ? parseFloat(value.replace("%", ""))
    : NaN;
  return isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * Model-scoped weekly limit (e.g. the Fable weekly cap shown by /usage) from
 * the API's generic limits[] array. The label comes from the API so a future
 * scoped model shows up without a code change.
 * @internal exported for tests.
 */
export function parseModelWeekly(value: unknown): ScopedLimit {
  if (!Array.isArray(value)) return { state: "unknown" };
  let sawScopedEntry = false;
  for (const entry of value) {
    const e = entry as {
      kind?: unknown;
      percent?: unknown;
      scope?: { model?: { display_name?: unknown } };
    };
    if (e?.kind !== "weekly_scoped") continue;
    sawScopedEntry = true;
    const label = e.scope?.model?.display_name;
    const percent = parsePercent(e.percent);
    if (typeof label === "string" && label.trim() && percent != null) {
      return { state: "found", limit: { label: label.trim(), percent } };
    }
  }
  return sawScopedEntry ? { state: "unknown" } : { state: "none" };
}

/**
 * The model-scoped limit lives in its own file rather than inside the snapshot
 * above, because every ccclub version that ever shipped rewrites
 * usage-cache.json wholesale. A sync running an older pinned build drops any
 * field it doesn't know about, blanking the statusline segment until the next
 * newer-build sync — and the same would happen to the next field added there.
 * Old builds never touch this path, so what they write here cannot regress.
 *
 * "no limit" is recorded rather than deleted, so a later run can tell a
 * checked-and-absent limit from one that was never fetched.
 * @internal exported for tests.
 */
export function writeModelWeekly(result: ScopedLimit, path = getModelWeeklyPath()): void {
  if (result.state === "unknown") return; // no evidence — keep the last value
  const body = JSON.stringify({
    ...(result.state === "found" ? result.limit : {}),
    fetchedAt: Date.now(),
  });
  // The statusline reads this on every turn while two writers (Stop hook and
  // LaunchAgent) may be running, so swap it in atomically: a plain write
  // truncates first, and a read landing in that window sees an empty file.
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, body);
    renameSync(tmp, path);
  } catch {
    // Unwritable — the statusline just keeps the previous value until it ages out.
    try { rmSync(tmp, { force: true }); } catch { /* nothing to clean up */ }
  }
}

/** Age of the recorded model-scoped limit; Infinity when never fetched. */
function modelWeeklyAgeMs(now: number): number {
  try {
    const raw = JSON.parse(readFileSync(getModelWeeklyPath(), "utf-8")) as { fetchedAt?: unknown };
    return typeof raw?.fetchedAt === "number" && isFinite(raw.fetchedAt) ? now - raw.fetchedAt : Infinity;
  } catch {
    return Infinity;
  }
}

/**
 * Whether the keychain token is expired. Claude Code stores expiresAt in epoch
 * milliseconds, but be tolerant of seconds in case that ever changes — the
 * previous version of this check compared seconds to milliseconds and so never
 * fired at all.
 * @internal exported for tests.
 */
export function isTokenExpired(expiresAt: unknown, now = Date.now()): boolean {
  if (typeof expiresAt !== "number" || !isFinite(expiresAt) || expiresAt <= 0) return false;
  const expiresMs = expiresAt > 1e11 ? expiresAt : expiresAt * 1000;
  return now > expiresMs;
}

/**
 * Read cc-costline's cache as a last-ditch usage source. /tmp is shared and
 * the file is another tool's, so trust it minimally: it must be a small
 * regular file (an lstat gate — a planted FIFO would block readFileSync
 * forever), and its numbers are only as fresh as its mtime, which the caller
 * must persist as the true fetch time. Restamping with "now" would launder
 * arbitrarily old percentages into data the statusline treats as live.
 * @internal exported for tests.
 */
export function readCostlineFallback(
  path: string,
  now = Date.now(),
): { snapshot: UsageSnapshot; fetchedAt: number } | null {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 4096) return null;
    const age = now - stat.mtimeMs;
    if (age < 0 || age > USAGE_MAX_AGE_MS) return null;
    const tmp = JSON.parse(readFileSync(path, "utf-8")) as { fiveHour?: unknown; sevenDay?: unknown };
    if (typeof tmp.fiveHour !== "number" || typeof tmp.sevenDay !== "number") return null;
    if (!isFinite(tmp.fiveHour) || !isFinite(tmp.sevenDay)) return null;
    return {
      snapshot: {
        fiveHour: tmp.fiveHour,
        sevenDay: tmp.sevenDay,
        snapshotAt: new Date(stat.mtimeMs).toISOString(),
      },
      fetchedAt: stat.mtimeMs,
    };
  } catch {
    return null; // no cc-costline cache
  }
}

/** Why an attempt to learn the limits came back without a live answer. */
export interface LimitsFailure {
  /** One line, fit for sync.log. Never contains the token. */
  reason: string;
  /**
   * Set when the machine simply has nothing to ask with — no keychain, no
   * Claude login. That is a standing condition, not an event worth a log line.
   */
  quiet?: boolean;
  /** The server's own Retry-After, when it sent one. */
  retryAfterMs?: number;
}

/**
 * Outcome of one attempt. `snapshot` is always the best answer available: on
 * "failed" that is whatever stale value could still be found, or null.
 */
export type LimitsResult =
  | { state: "cached"; snapshot: UsageSnapshot }
  | { state: "fetched"; snapshot: UsageSnapshot }
  | { state: "failed"; snapshot: UsageSnapshot | null; failure: LimitsFailure };

/** Retry-After in ms; only the delta-seconds form, capped so one odd header cannot park us. */
function parseRetryAfter(value: string | null): number | undefined {
  if (value == null || !/^\d+$/.test(value.trim())) return undefined;
  return Math.min(Number(value.trim()), 60 * 60) * 1000;
}

/** Read the OAuth token Claude Code keeps in the macOS keychain. */
function readAccessToken(): { accessToken: string } | LimitsFailure {
  let raw: string;
  try {
    const username = process.env.USER || process.env.USERNAME || userInfo().username;
    debug("username:", username);

    // Keychain lookup is fast (~50ms), sync is fine here. execFile, not exec:
    // the username must reach `security` as an argument, never as shell text.
    raw = execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-a", username, "-w"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 },
    ).trim();
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { status?: number | null };
    debug("keychain error:", e?.code, e?.status);
    if (e?.code === "ENOENT") return { reason: "no keychain on this platform", quiet: true };
    if (e?.code === "ETIMEDOUT") return { reason: "keychain lookup timed out after 5s" };
    // 44 is `security`'s "item not found": Claude Code is not logged in here.
    if (e?.status === 44) return { reason: "no Claude Code credentials in the keychain", quiet: true };
    return { reason: `keychain lookup failed (security exited ${e?.status ?? "abnormally"})` };
  }

  debug("keychain raw length:", raw.length);

  let oauth: { accessToken?: unknown; expiresAt?: unknown } | undefined;
  try {
    oauth = (JSON.parse(raw) as { claudeAiOauth?: typeof oauth })?.claudeAiOauth;
  } catch {
    return { reason: "keychain entry is not JSON" };
  }

  debug("accessToken present:", !!oauth?.accessToken, "expiresAt:", oauth?.expiresAt);

  if (!oauth?.accessToken || typeof oauth.accessToken !== "string") {
    return { reason: "no OAuth token in the keychain entry", quiet: true };
  }
  if (isTokenExpired(oauth.expiresAt)) {
    return { reason: "OAuth token expired; Claude Code renews it on its next request" };
  }
  return { accessToken: oauth.accessToken };
}

/** One live request. Writes both caches on success; never throws. */
async function requestLimits(timeoutMs: number): Promise<UsageSnapshot | LimitsFailure> {
  const token = readAccessToken();
  if (!("accessToken" in token)) return token;

  let res: Response;
  try {
    // Native fetch, not curl: a Bearer token on a subprocess command line is
    // visible to every local process via `ps`.
    res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        "Authorization": `Bearer ${token.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-code/2.1.5",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { reason: `request timed out after ${Math.round(timeoutMs / 1000)}s` };
    }
    // Node wraps network errors as TypeError("fetch failed") with the real one
    // in .cause. (Not formatFetchError: its hints are written for a terminal,
    // and it would pull chalk into the light limits binary.)
    const cause = (err as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
    const detail = typeof cause?.code === "string" ? cause.code
      : typeof cause?.message === "string" ? cause.message
      : err instanceof Error ? err.message : String(err);
    return { reason: `request failed: ${detail.replace(/\s+/g, " ").slice(0, 120)}` };
  }
  debug("usage API status:", res.status);

  let data: Record<string, unknown> | null = null;
  try {
    const body = (await res.json()) as unknown;
    if (body != null && typeof body === "object") data = body as Record<string, unknown>;
  } catch {
    // An HTML error page, or a body cut short — the status says what there is to say.
  }

  if (!res.ok || data == null || data.error) {
    const type = (data?.error as { type?: unknown } | undefined)?.type;
    debug("API error response:", data?.error);
    return {
      reason: `HTTP ${res.status}${typeof type === "string" ? ` ${type}` : ""}`,
      retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
    };
  }

  const fiveHourRaw = (data.five_hour as Record<string, unknown>)?.utilization;
  const sevenDayRaw = (data.seven_day as Record<string, unknown>)?.utilization;
  const result: UsageSnapshot = {
    fiveHour: parseUtilization(fiveHourRaw),
    sevenDay: parseUtilization(sevenDayRaw),
    snapshotAt: new Date().toISOString(),
  };
  debug("returning snapshot:", result.fiveHour, result.sevenDay);
  writeCache(result);
  writeModelWeekly(parseModelWeekly(data.limits));
  return result;
}

/**
 * Learn the current limits: from the cache while it is younger than
 * `maxAgeMs`, otherwise with one request. Never throws.
 *
 * The request carries its own abort timer, and that timer lives on this
 * process's event loop: a caller that blocks the loop past `timeoutMs` while
 * the request is in flight makes it fail even though the answer arrived in
 * time. Await this before starting anything heavy rather than alongside it.
 */
export async function refreshUsageLimits(
  options: { maxAgeMs?: number; timeoutMs?: number } = {},
): Promise<LimitsResult> {
  const maxAgeMs = options.maxAgeMs ?? CACHE_TTL_MS;
  const cached = readCache(maxAgeMs);
  // Both files have to be fresh to skip the request. usage-cache.json alone is
  // not a safe gate: older builds keep restamping it (hook and LaunchAgent),
  // so on a mixed-version machine this would return early forever and the
  // model-scoped limit — which only this build writes — would never refresh.
  if (cached && modelWeeklyAgeMs(Date.now()) < maxAgeMs) {
    debug("returning cached snapshot:", cached.fiveHour, cached.sevenDay);
    return { state: "cached", snapshot: cached };
  }

  let failure: LimitsFailure;
  try {
    const outcome = await requestLimits(options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    if (!("reason" in outcome)) return { state: "fetched", snapshot: outcome };
    failure = outcome;
  } catch (err) {
    failure = { reason: `unexpected error: ${err instanceof Error ? err.message : String(err)}` };
  }
  debug("failed:", failure.reason);

  // Fallbacks: our own stale cache vs cc-costline's /tmp file — whichever was
  // actually fetched more recently wins, and the honest timestamp is kept so
  // the statusline's freshness bound still means something.
  const ownStale = readStoredCache();
  const costline = readCostlineFallback("/tmp/sl-claude-usage");
  if (costline && (ownStale == null || costline.fetchedAt > ownStale.fetchedAt)) {
    debug("returning cc-costline fallback:", costline.snapshot.fiveHour, costline.snapshot.sevenDay);
    writeCache(costline.snapshot, costline.fetchedAt);
    return { state: "failed", snapshot: costline.snapshot, failure };
  }
  if (ownStale) debug("returning stale cache as fallback:", ownStale.snapshot.fiveHour, ownStale.snapshot.sevenDay);
  return { state: "failed", snapshot: ownStale?.snapshot ?? null, failure };
}

export async function fetchUsageLimits(): Promise<UsageSnapshot | null> {
  return (await refreshUsageLimits()).snapshot;
}

export function getLimitsStatePath(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "limits-state.json");
}

/**
 * How the last attempts went. Read by the statusline to space out its own
 * retries (see shouldRefreshLimits), written only by recordLimitsOutcome.
 */
export interface LimitsState {
  /** Consecutive failed attempts; 0 once one succeeds. */
  failures: number;
  reason?: string;
  /** When the current run of failures began. */
  since?: number;
  /** Server-requested earliest retry, epoch ms. */
  retryAt?: number;
}

/** A missing or malformed file reads as "no failures". */
export function readLimitsState(path = getLimitsStatePath()): LimitsState {
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as LimitsState | null;
    const failures = raw?.failures;
    if (typeof failures !== "number" || !Number.isInteger(failures) || failures <= 0) return { failures: 0 };
    return {
      failures,
      reason: typeof raw?.reason === "string" ? raw.reason : undefined,
      since: typeof raw?.since === "number" && isFinite(raw.since) ? raw.since : undefined,
      retryAt: typeof raw?.retryAt === "number" && isFinite(raw.retryAt) ? raw.retryAt : undefined,
    };
  } catch {
    return { failures: 0 };
  }
}

/**
 * Keep the failure streak, and say so in sync.log when it starts, changes
 * cause, or ends. Every caller of refreshUsageLimits runs in the background,
 * and a failed attempt quietly hands back the stale cache — which is how the
 * statusline once sat on a 30-minute-old 82% while the account went to 97%,
 * across two syncs that both "succeeded", with nothing anywhere to say why.
 *
 * Logging the transitions rather than every attempt keeps an offline laptop
 * from writing a line every five minutes all night. Never throws.
 */
export async function recordLimitsOutcome(
  result: LimitsResult,
  options: { statePath?: string; logPath?: string; now?: number } = {},
): Promise<void> {
  if (result.state === "cached") return; // no attempt was made
  const statePath = options.statePath ?? getLimitsStatePath();
  const logPath = options.logPath ?? join(homedir(), CCCLUB_CONFIG_DIR, "sync.log");
  const now = options.now ?? Date.now();
  const stamp = new Date(now).toISOString();
  const previous = readLimitsState(statePath);

  let next: LimitsState;
  let line: string | null = null;
  if (result.state === "fetched") {
    if (previous.failures === 0) return; // steady state: nothing to write
    next = { failures: 0 };
    const minutes = previous.since != null ? Math.max(0, Math.round((now - previous.since) / 60_000)) : null;
    line = `usage limits: recovered after ${previous.failures} failed attempt${previous.failures === 1 ? "" : "s"}` +
      (minutes != null ? ` over ${minutes} min` : "");
  } else {
    const { reason, quiet, retryAfterMs } = result.failure;
    next = {
      failures: previous.failures + 1,
      reason,
      since: previous.failures > 0 && previous.since != null ? previous.since : now,
      ...(retryAfterMs != null ? { retryAt: now + retryAfterMs } : {}),
    };
    if (!quiet && (previous.failures === 0 || previous.reason !== reason)) line = `usage limits: ${reason}`;
  }

  const tmp = `${statePath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(next));
    renameSync(tmp, statePath);
  } catch {
    try { rmSync(tmp, { force: true }); } catch { /* nothing to clean up */ }
  }
  if (line != null) await appendCappedLog(logPath, `${stamp} ${line}\n`);
}
