import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { CCCLUB_CONFIG_DIR } from "@ccclub/shared";
import { isGloballyInstalled } from "./global-install.js";
import { atomicWriteFile } from "./fs-utils.js";

const CLAUDE_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

// The dedicated light binary, installed alongside `ccclub` by npm.
export const STATUSLINE_COMMAND = "ccclub-statusline";

// Written by `ccclub statusline off`; stops every automatic enable path from
// ever reinstalling behind the user's back.
const OPT_OUT_PATH = join(homedir(), CCCLUB_CONFIG_DIR, "statusline-opt-out");

// Written after the one automatic enable, making "one-time" actually one-time:
// without it, a user who removed the statusLine key by hand (rather than via
// `ccclub statusline off`) would get it re-added on every ccclub run.
const AUTO_ENABLED_PATH = join(homedir(), CCCLUB_CONFIG_DIR, "statusline-auto-enabled");

// Timestamp of the last failed global-binary probe. Background retries read
// this so an npx-only machine costs one `npm list -g` per throttle window,
// not one per five-minute sync.
const GLOBAL_RETRY_PATH = join(homedir(), CCCLUB_CONFIG_DIR, "statusline-global-retry");

export type StatuslineState = "ours" | "other" | "none";

interface ClaudeSettings {
  statusLine?: { type?: string; command?: string };
  [key: string]: unknown;
}

async function readSettings(path: string): Promise<ClaudeSettings | null> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, "utf-8")) as ClaudeSettings;
  } catch {
    return null; // Unparseable settings — never risk clobbering the user's file.
  }
}

function stateOf(settings: ClaudeSettings): StatuslineState {
  const command = settings.statusLine?.command;
  if (settings.statusLine == null) return "none";
  // Exact match only: a user's custom pipeline that merely mentions ccclub
  // (e.g. "ccclub-statusline | my-filter") is theirs, and "other" is the
  // classification that protects it from being overwritten or removed.
  if (command === STATUSLINE_COMMAND) return "ours";
  return "other";
}

export async function getStatuslineState(settingsPath = CLAUDE_SETTINGS_PATH): Promise<StatuslineState> {
  const settings = await readSettings(settingsPath);
  return settings == null ? "other" : stateOf(settings);
}

/**
 * Point Claude Code's statusline at ccclub. Succeeds only when no statusline
 * is configured (or ours already is) — an existing cc-costline or custom
 * command is never overwritten.
 */
export async function installStatusline(settingsPath = CLAUDE_SETTINGS_PATH): Promise<boolean> {
  try {
    const settings = await readSettings(settingsPath);
    if (settings == null || stateOf(settings) === "other") return false;

    settings.statusLine = { type: "command", command: STATUSLINE_COMMAND };
    await mkdir(dirname(settingsPath), { recursive: true });
    await atomicWriteFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    return true;
  } catch {
    return false;
  }
}

/** Remove the statusline only if it is ours. */
export async function uninstallStatusline(settingsPath = CLAUDE_SETTINGS_PATH): Promise<boolean> {
  try {
    const settings = await readSettings(settingsPath);
    if (settings == null) return false;
    if (stateOf(settings) !== "ours") return true; // Nothing of ours to remove.

    delete settings.statusLine;
    await atomicWriteFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    return true;
  } catch {
    return false;
  }
}

export function hasOptedOut(optOutPath = OPT_OUT_PATH): boolean {
  return existsSync(optOutPath);
}

export async function setOptOut(optOutPath = OPT_OUT_PATH): Promise<void> {
  try {
    await mkdir(dirname(optOutPath), { recursive: true });
    await writeFile(optOutPath, new Date().toISOString());
  } catch { /* best effort */ }
}

export async function clearOptOut(optOutPath = OPT_OUT_PATH): Promise<void> {
  try {
    await rm(optOutPath, { force: true });
  } catch { /* best effort */ }
}

/** Why an automatic enable did or didn't happen. Only "enabled" changed anything. */
export type AutoEnableOutcome =
  | "enabled"      // newly enabled just now
  | "already-done" // the one automatic enable already happened on this machine
  | "opted-out"    // user ran `ccclub statusline off`
  | "occupied"     // a statusline is configured (ours or someone else's)
  | "no-global"    // the ccclub-statusline binary isn't globally installed
  | "throttled"    // background retry window for the global probe not reached
  | "failed";      // eligible, but writing settings.json failed

/**
 * Automatic enable with a once-ever marker: only when nothing else is
 * configured, the user never opted out, and the global binary resolves.
 *
 * Callers fall into two kinds. Interactive commands (rank, init, join) call
 * it bare and can show the outcome. Background sync passes retryThrottleMs —
 * that is what makes this converge: the original enable had exactly one shot
 * (first init/join, and only if `npm install -g` happened to succeed that
 * day), and a machine that missed it stayed without a statusline forever.
 * With sync retrying, it appears within one heartbeat of the blocker
 * clearing. The cost stays negligible: the common outcomes short-circuit on
 * local file reads, and only an eligible machine probes `npm list -g`, at
 * most once per throttle window.
 */
export async function maybeAutoEnableStatusline(deps: {
  settingsPath?: string;
  optOutPath?: string;
  autoEnabledPath?: string;
  globalRetryPath?: string;
  /** When set, a failed global probe is not repeated within this window. */
  retryThrottleMs?: number;
  checkGlobal?: () => Promise<boolean>;
  now?: number;
} = {}): Promise<AutoEnableOutcome> {
  const autoEnabledPath = deps.autoEnabledPath ?? AUTO_ENABLED_PATH;
  const globalRetryPath = deps.globalRetryPath ?? GLOBAL_RETRY_PATH;
  const now = deps.now ?? Date.now();
  try {
    if (existsSync(autoEnabledPath)) return "already-done";
    if (hasOptedOut(deps.optOutPath)) return "opted-out";
    if ((await getStatuslineState(deps.settingsPath)) !== "none") return "occupied";

    if (deps.retryThrottleMs != null && existsSync(globalRetryPath)) {
      try {
        const last = parseInt(readFileSync(globalRetryPath, "utf-8").trim(), 10);
        const age = now - last;
        if (Number.isFinite(last) && age >= 0 && age < deps.retryThrottleMs) return "throttled";
      } catch { /* unreadable throttle file — probe again */ }
    }

    if (!(await (deps.checkGlobal ?? isGloballyInstalled)())) {
      if (deps.retryThrottleMs != null) {
        try {
          await mkdir(dirname(globalRetryPath), { recursive: true });
          await writeFile(globalRetryPath, String(now));
        } catch { /* best effort */ }
      }
      return "no-global";
    }

    if (!(await installStatusline(deps.settingsPath))) return "failed";
    await mkdir(dirname(autoEnabledPath), { recursive: true });
    await writeFile(autoEnabledPath, new Date(now).toISOString());
    return "enabled";
  } catch {
    return "failed";
  }
}
