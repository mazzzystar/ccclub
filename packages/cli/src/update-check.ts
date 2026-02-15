import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { CCCLUB_CONFIG_DIR } from "@ccclub/shared";

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const CHECK_FILE = join(homedir(), CCCLUB_CONFIG_DIR, "last-update-check");

interface CheckResult {
  latest: string;
  current: string;
}

let pendingCheck: Promise<CheckResult | null> | null = null;

/**
 * Start a non-blocking version check in the background.
 * Call this early, then await getUpdateResult() later when ready to display.
 */
export function startUpdateCheck(currentVersion: string): void {
  // Skip in silent mode (hook calls)
  if (process.argv.includes("--silent") || process.argv.includes("-s")) return;

  // Throttle: only check once per 12 hours
  try {
    if (existsSync(CHECK_FILE)) {
      const ts = parseInt(readFileSync(CHECK_FILE, "utf-8").trim(), 10);
      if (Date.now() - ts < CHECK_INTERVAL_MS) return;
    }
  } catch { /* proceed */ }

  pendingCheck = (async () => {
    try {
      const res = await fetch("https://registry.npmjs.org/ccclub/latest", {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { version: string };
      if (data.version !== currentVersion) {
        // Don't save timestamp — keep notifying until user updates
        return { latest: data.version, current: currentVersion };
      }
      // Up-to-date: throttle next check for 12 hours
      try { writeFileSync(CHECK_FILE, String(Date.now())); } catch { /* ignore */ }
      return null;
    } catch {
      return null;
    }
  })();
}

/**
 * Get the result of a previously started update check.
 * Returns null if no update available or check was skipped.
 */
export async function getUpdateResult(): Promise<CheckResult | null> {
  if (!pendingCheck) return null;
  return pendingCheck;
}
