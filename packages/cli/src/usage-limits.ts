import { execSync, exec } from "node:child_process";
import { promisify } from "node:util";
import { userInfo, homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { CCCLUB_CONFIG_DIR } from "@ccclub/shared";
import type { UsageSnapshot } from "@ccclub/shared";

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

export async function fetchUsageLimits(): Promise<UsageSnapshot | null> {
  const cached = readCache();
  if (cached) {
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
        const result = {
          fiveHour: parseUtilization(fiveHourRaw),
          sevenDay: parseUtilization(sevenDayRaw),
          snapshotAt: new Date().toISOString(),
        };
        debug("returning snapshot:", result.fiveHour, result.sevenDay);
        writeCache(result);
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
