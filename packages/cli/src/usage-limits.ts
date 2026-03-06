import { execSync } from "node:child_process";
import { userInfo } from "node:os";
import type { UsageSnapshot } from "@ccclub/shared";

export type { UsageSnapshot };

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
    const raw = execSync(
      `security find-generic-password -s "Claude Code-credentials" -a "${username}" -w`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 }
    ).trim();

    const credentials = JSON.parse(raw);
    const accessToken = credentials?.claudeAiOauth?.accessToken;
    if (!accessToken || typeof accessToken !== "string") return null;

    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) return null;

    const data = await res.json() as Record<string, unknown>;
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
