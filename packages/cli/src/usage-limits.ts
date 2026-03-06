import { execSync, exec } from "node:child_process";
import { promisify } from "node:util";
import { userInfo } from "node:os";
import type { UsageSnapshot } from "@ccclub/shared";

export type { UsageSnapshot };

const execAsync = promisify(exec);

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
    const username = userInfo().username;
    // Keychain lookup is fast (~50ms), sync is fine here
    const raw = execSync(
      `security find-generic-password -s "Claude Code-credentials" -a "${username}" -w`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 }
    ).trim();

    const credentials = JSON.parse(raw);
    const accessToken = credentials?.claudeAiOauth?.accessToken;
    if (!accessToken || typeof accessToken !== "string") return null;

    // Use async exec so Node event loop stays free (curl bypasses proxy issues with native fetch)
    const curlCmd = `curl -sf --max-time 8 "https://api.anthropic.com/api/oauth/usage" -H "Authorization: Bearer ${accessToken}" -H "anthropic-beta: oauth-2025-04-20" -H "User-Agent: claude-code/2.1.5"`;
    const { stdout } = await execAsync(curlCmd, { timeout: 9000 });
    if (!stdout) return null;

    const data = JSON.parse(stdout) as Record<string, unknown>;
    if ((data as { error?: unknown }).error) return null;

    const fiveHourRaw = (data.five_hour as Record<string, unknown>)?.utilization;
    const sevenDayRaw = (data.seven_day as Record<string, unknown>)?.utilization;

    return {
      fiveHour: parseUtilization(fiveHourRaw),
      sevenDay: parseUtilization(sevenDayRaw),
      snapshotAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
