import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";

const PLIST_NAME = "dev.ccclub.sync";
const LAUNCH_AGENTS_DIR = join(homedir(), "Library", "LaunchAgents");
const PLIST_PATH = join(LAUNCH_AGENTS_DIR, `${PLIST_NAME}.plist`);

function getPlist(): string {
  // Find the ccclub binary - prefer global npx path
  const logPath = join(homedir(), ".ccclub", "sync.log");
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
    <string>ccclub</string>
    <string>sync</string>
    <string>--silent</string>
  </array>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>`;
}

function isCurrentPlist(): boolean {
  if (!existsSync(PLIST_PATH)) return false;
  try {
    return readFileSync(PLIST_PATH, "utf-8") === getPlist();
  } catch {
    return false;
  }
}

async function launchctl(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile("launchctl", args, (err) => (err ? reject(err) : resolve()));
  });
}

export async function installHeartbeat(): Promise<boolean> {
  // Only support macOS for now
  if (process.platform !== "darwin") {
    return false;
  }

  if (isCurrentPlist()) {
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
}

export function isHeartbeatInstalled(): boolean {
  return isCurrentPlist();
}

export function getHeartbeatPath(): string {
  return PLIST_PATH;
}
