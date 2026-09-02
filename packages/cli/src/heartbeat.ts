import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { extractPinnedVersion, isNewerPin, type PinOptions } from "./pin-version.js";
import { getCurrentVersion } from "./version.js";

const PLIST_NAME = "dev.ccclub.sync";
const LAUNCH_AGENTS_DIR = join(homedir(), "Library", "LaunchAgents");
const PLIST_PATH = join(LAUNCH_AGENTS_DIR, `${PLIST_NAME}.plist`);

/** Minimal XML text escaping — a homedir or node path can contain & or <. */
function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Build the LaunchAgent plist for the 5-minute heartbeat sync.
 * Mirrored in scripts/postinstall.cjs (which cannot import this ESM module);
 * heartbeat.test.ts asserts the two templates stay identical.
 * @internal exported only so the generated plist can be unit-tested.
 */
export function getPlist(version = getCurrentVersion()): string {
  const logPath = join(homedir(), ".ccclub", "sync.log");
  // Prepend the running Node's bin dir so launchd can resolve `npx`/`node`
  // even when Node is installed via a version manager (nvm/asdf/volta),
  // whose bin dir is not in the default system PATH. Fixes #18.
  const pathEnv = `${dirname(process.execPath)}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>npx</string>
    <string>--yes</string>
    <string>ccclub@${xmlEscape(version)}</string>
    <string>sync</string>
    <string>--silent</string>
  </array>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logPath)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(pathEnv)}</string>
  </dict>
</dict>
</plist>`;
}

/**
 * Keep the on-disk LaunchAgent when it already matches this CLI, or when it
 * is pinned to a newer release. Same-version PATH/template drift still
 * rewrites; an older binary must not treat a forward pin as stale.
 *
 * Deliberate trade-off: a NEWER pin whose template has drifted (a deleted
 * nvm bin dir, a yanked release) is not repaired by an older CLI running on
 * its own — only `options.force` from an explicit `ccclub init` / hook path
 * takes it back. Repairing it automatically would reopen the downgrade loop.
 * @internal exported for regression tests and the postinstall lockstep check.
 */
export function shouldKeepExistingPlist(
  existing: string,
  version = getCurrentVersion(),
  options: PinOptions = {},
): boolean {
  // Identical template is a no-op with or without force: rewriting it would
  // only churn a launchctl unload/load for a byte-identical file.
  if (existing === getPlist(version)) return true;
  if (options.force) return false;
  return isNewerPin(extractPinnedVersion(existing), version);
}

/**
 * The version the on-disk LaunchAgent is pinned to when it is ahead of this
 * CLI — i.e. the pin the guard above just refused to rewrite. Null when
 * there is no plist, no readable pin, or the pin is not ahead. Callers print
 * the notice; the predicates stay silent.
 */
export function newerPinnedHeartbeatVersion(version = getCurrentVersion()): string | null {
  if (!existsSync(PLIST_PATH)) return null;
  try {
    const pinned = extractPinnedVersion(readFileSync(PLIST_PATH, "utf-8"));
    return pinned != null && isNewerPin(pinned, version) ? pinned : null;
  } catch {
    return null;
  }
}

function isCurrentPlist(force = false): boolean {
  if (!existsSync(PLIST_PATH)) return false;
  try {
    return shouldKeepExistingPlist(readFileSync(PLIST_PATH, "utf-8"), getCurrentVersion(), { force });
  } catch {
    return false;
  }
}

async function launchctl(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile("launchctl", args, (err) => (err ? reject(err) : resolve()));
  });
}

export async function installHeartbeat(options: PinOptions = {}): Promise<boolean> {
  // Only support macOS for now
  if (process.platform !== "darwin") {
    return false;
  }

  // Callers rely on the boolean contract: this must never throw. A rejection
  // here (unwritable LaunchAgents dir, plist path occupied by a directory)
  // used to propagate into doSync and silently abort the entire sync.
  try {
    if (isCurrentPlist(options.force)) {
      return true; // already installed
    }

    // Ensure LaunchAgents directory exists
    if (!existsSync(LAUNCH_AGENTS_DIR)) {
      await mkdir(LAUNCH_AGENTS_DIR, { recursive: true });
    }

    if (existsSync(PLIST_PATH)) {
      try {
        await launchctl(["unload", PLIST_PATH]);
      } catch {
        // Non-fatal: it may not be loaded yet.
      }
    }

    await writeFile(PLIST_PATH, getPlist());

    // Load the plist so the heartbeat starts immediately
    try {
      await launchctl(["load", PLIST_PATH]);
    } catch {
      // Non-fatal: plist will be loaded on next login
    }

    return true;
  } catch {
    return false;
  }
}

export function isHeartbeatInstalled(): boolean {
  return isCurrentPlist();
}

export function getHeartbeatPath(): string {
  return PLIST_PATH;
}
