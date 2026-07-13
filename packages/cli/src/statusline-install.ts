import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { CCCLUB_CONFIG_DIR } from "@ccclub/shared";
import { isGloballyInstalled } from "./global-install.js";

const CLAUDE_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

// The dedicated light binary, installed alongside `ccclub` by npm.
export const STATUSLINE_COMMAND = "ccclub-statusline";

// Written by `ccclub statusline off`; stops every automatic enable path from
// ever reinstalling behind the user's back.
const OPT_OUT_PATH = join(homedir(), CCCLUB_CONFIG_DIR, "statusline-opt-out");

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
  if (typeof command === "string" && command.includes("ccclub")) return "ours";
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
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
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
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n");
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

/**
 * One-time automatic enable for users who set up ccclub before the statusline
 * existed: only when nothing else is configured, the user never opted out,
 * and the global binary actually resolves. Returns true when newly enabled.
 */
export async function maybeAutoEnableStatusline(): Promise<boolean> {
  try {
    if (hasOptedOut()) return false;
    if ((await getStatuslineState()) !== "none") return false;
    if (!(await isGloballyInstalled())) return false;
    return await installStatusline();
  } catch {
    return false;
  }
}
