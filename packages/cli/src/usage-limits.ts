import { execFileSync } from "node:child_process";
import { userInfo, homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, renameSync, rmSync, lstatSync } from "node:fs";
import { CCCLUB_CONFIG_DIR } from "@ccclub/shared";
import type { UsageSnapshot } from "@ccclub/shared";
import { getModelWeeklyPath, USAGE_MAX_AGE_MS } from "./statusline.js";
import type { ModelWeekly } from "./statusline.js";

export type { UsageSnapshot };

const debug = (...args: unknown[]) => {
  if (process.env.CCCLUB_DEBUG) console.error("[usage-debug]", ...args);
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
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

function readCache(allowStale = false): UsageSnapshot | null {
  const stored = readStoredCache();
  if (stored == null) return null;
  const age = Date.now() - stored.fetchedAt;
  // A future-dated timestamp would otherwise count as fresh forever.
  if (allowStale || (age >= 0 && age < CACHE_TTL_MS)) return stored.snapshot;
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

export async function fetchUsageLimits(): Promise<UsageSnapshot | null> {
  const cached = readCache();
  // Both files have to be fresh to skip the request. usage-cache.json alone is
  // not a safe gate: older builds keep restamping it (hook and LaunchAgent),
  // so on a mixed-version machine this would return early forever and the
  // model-scoped limit — which only this build writes — would never refresh.
  if (cached && modelWeeklyAgeMs(Date.now()) < CACHE_TTL_MS) {
    debug("returning cached snapshot:", cached.fiveHour, cached.sevenDay);
    return cached;
  }

  try {
    const username = process.env.USER || process.env.USERNAME || userInfo().username;
    debug("username:", username);

    // Keychain lookup is fast (~50ms), sync is fine here. execFile, not exec:
    // the username must reach `security` as an argument, never as shell text.
    const raw = execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-a", username, "-w"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 },
    ).trim();

    debug("keychain raw length:", raw.length);

    const credentials = JSON.parse(raw);
    const accessToken = credentials?.claudeAiOauth?.accessToken;
    const expiresAt = credentials?.claudeAiOauth?.expiresAt as number | undefined;

    debug("accessToken present:", !!accessToken, "expiresAt:", expiresAt);

    if (!accessToken || typeof accessToken !== "string") {
      debug("returning null: no accessToken");
      return null;
    }

    if (isTokenExpired(expiresAt)) {
      debug("skipping request: token expired at", expiresAt);
    } else {
      // Native fetch, not curl: a Bearer token on a subprocess command line is
      // visible to every local process via `ps`.
      const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
          "User-Agent": "claude-code/2.1.5",
        },
        signal: AbortSignal.timeout(8000),
      });
      const data = (await res.json()) as Record<string, unknown>;
      debug("usage API status:", res.status);

      if (!data.error) {
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
      debug("API error response:", data.error);
      // API error (e.g. 429) — fall through to cached fallbacks below
    }
  } catch (err) {
    debug("caught error:", err instanceof Error ? err.message : String(err));
  }

  // Fallbacks: our own stale cache vs cc-costline's /tmp file — whichever was
  // actually fetched more recently wins, and the honest timestamp is kept so
  // the statusline's freshness bound still means something.
  const ownStale = readStoredCache();
  const costline = readCostlineFallback("/tmp/sl-claude-usage");
  if (costline && (ownStale == null || costline.fetchedAt > ownStale.fetchedAt)) {
    debug("returning cc-costline fallback:", costline.snapshot.fiveHour, costline.snapshot.sevenDay);
    writeCache(costline.snapshot, costline.fetchedAt);
    return costline.snapshot;
  }
  if (ownStale) debug("returning stale cache as fallback:", ownStale.snapshot.fiveHour, ownStale.snapshot.sevenDay);
  return ownStale?.snapshot ?? null;
}
