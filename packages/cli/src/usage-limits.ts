import { execSync, exec } from "node:child_process";
import { promisify } from "node:util";
import { userInfo, homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { CCCLUB_CONFIG_DIR } from "@ccclub/shared";
import type { UsageSnapshot } from "@ccclub/shared";
import { getModelWeeklyPath } from "./statusline.js";
import type { ModelWeekly } from "./statusline.js";

export type { UsageSnapshot };

const execAsync = promisify(exec);

const debug = (...args: unknown[]) => {
  if (process.env.CCCLUB_DEBUG) console.error("[usage-debug]", ...args);
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_PATH = join(homedir(), CCCLUB_CONFIG_DIR, "usage-cache.json");

function readCache(allowStale = false): UsageSnapshot | null {
  try {
    const raw = readFileSync(CACHE_PATH, "utf-8");
    const { snapshot, fetchedAt } = JSON.parse(raw) as { snapshot: UsageSnapshot; fetchedAt: number };
    if (allowStale || Date.now() - fetchedAt < CACHE_TTL_MS) return snapshot;
  } catch { /* no cache or parse error */ }
  return null;
}

function writeCache(snapshot: UsageSnapshot): void {
  try { writeFileSync(CACHE_PATH, JSON.stringify({ snapshot, fetchedAt: Date.now() })); } catch { /* ignore */ }
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
  const tmp = `${path}.tmp`;
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

    // Keychain lookup is fast (~50ms), sync is fine here
    const raw = execSync(
      `security find-generic-password -s "Claude Code-credentials" -a "${username}" -w`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 }
    ).trim();

    debug("keychain raw length:", raw.length, "first 40:", raw.slice(0, 40));

    const credentials = JSON.parse(raw);
    const accessToken = credentials?.claudeAiOauth?.accessToken;
    const expiresAt = credentials?.claudeAiOauth?.expiresAt as number | undefined;

    debug("accessToken present:", !!accessToken, "expiresAt:", expiresAt);

    if (!accessToken || typeof accessToken !== "string") {
      debug("returning null: no accessToken");
      return null;
    }

    if (expiresAt && Date.now() / 1000 > expiresAt) {
      debug("returning null: token expired at", expiresAt);
      return null;
    }

    // Use async exec so Node event loop stays free; omit -f so 429 body is readable
    const curlCmd = `curl -s --max-time 8 "https://api.anthropic.com/api/oauth/usage" -H "Authorization: Bearer ${accessToken}" -H "anthropic-beta: oauth-2025-04-20" -H "User-Agent: claude-code/2.1.5"`;
    debug("running curl...");
    const { stdout } = await execAsync(curlCmd, { timeout: 9000 });
    debug("curl stdout length:", stdout.length, "first 100:", stdout.slice(0, 100));

    if (stdout) {
      const data = JSON.parse(stdout) as Record<string, unknown>;
      if (!(data as { error?: unknown }).error) {
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
      debug("API error response:", (data as { error?: unknown }).error);
    }
    // API error (e.g. 429) — fall through to cached fallbacks below
  } catch (err) {
    debug("caught error:", err instanceof Error ? err.message : String(err));
  }

  // Fallback 1: cc-costline's /tmp/sl-claude-usage (often fresher)
  try {
    const tmp = JSON.parse(readFileSync("/tmp/sl-claude-usage", "utf-8")) as { fiveHour: number; sevenDay: number };
    if (typeof tmp.fiveHour === "number" && typeof tmp.sevenDay === "number") {
      const result = { fiveHour: tmp.fiveHour, sevenDay: tmp.sevenDay, snapshotAt: new Date().toISOString() };
      debug("returning cc-costline cache fallback:", result.fiveHour, result.sevenDay);
      writeCache(result);
      return result;
    }
  } catch { /* no cc-costline cache */ }

  // Fallback 2: our own stale cache
  const stale = readCache(true);
  if (stale) debug("returning stale cache as fallback:", stale.fiveHour, stale.sevenDay);
  return stale;
}
