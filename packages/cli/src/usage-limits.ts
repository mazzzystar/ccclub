import { execSync, exec } from "node:child_process";
import { promisify } from "node:util";
import { userInfo } from "node:os";
import type { UsageSnapshot } from "@ccclub/shared";

export type { UsageSnapshot };

const execAsync = promisify(exec);

const debug = (...args: unknown[]) => {
  if (process.env.CCCLUB_DEBUG) console.error("[usage-debug]", ...args);
};

function parseUtilization(value: unknown): number {
  if (typeof value === "number") return Math.round(value * 100) / 100;
  if (typeof value === "string") {
    const n = parseFloat(value.replace("%", ""));
    return isNaN(n) ? 0 : Math.round(n * 100) / 100;
  }
  return 0;
}

export async function fetchUsageLimits(): Promise<UsageSnapshot | null> {
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

    // Use async exec so Node event loop stays free (curl bypasses proxy issues with native fetch)
    // --noproxy '*' ensures proxy env vars don't interfere
    const curlCmd = `curl -sf --max-time 8 --noproxy '*' "https://api.anthropic.com/api/oauth/usage" -H "Authorization: Bearer ${accessToken}" -H "anthropic-beta: oauth-2025-04-20" -H "User-Agent: claude-code/2.1.5"`;
    debug("running curl...");
    const { stdout } = await execAsync(curlCmd, { timeout: 9000 });
    debug("curl stdout length:", stdout.length, "first 100:", stdout.slice(0, 100));

    if (!stdout) {
      debug("returning null: empty stdout");
      return null;
    }

    const data = JSON.parse(stdout) as Record<string, unknown>;
    if ((data as { error?: unknown }).error) {
      debug("returning null: data.error =", (data as { error?: unknown }).error);
      return null;
    }

    const fiveHourRaw = (data.five_hour as Record<string, unknown>)?.utilization;
    const sevenDayRaw = (data.seven_day as Record<string, unknown>)?.utilization;

    const result = {
      fiveHour: parseUtilization(fiveHourRaw),
      sevenDay: parseUtilization(sevenDayRaw),
      snapshotAt: new Date().toISOString(),
    };
    debug("returning snapshot:", result.fiveHour, result.sevenDay);
    return result;
  } catch (err) {
    debug("caught error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
