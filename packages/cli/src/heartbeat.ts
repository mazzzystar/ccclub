import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
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
  <integer>3600</integer>
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

export async function installHeartbeat(): Promise<boolean> {
  // Only support macOS for now
  if (process.platform !== "darwin") {
    return false;
  }

  if (existsSync(PLIST_PATH)) {
    return true; // already installed
  }

  // Ensure LaunchAgents directory exists
  if (!existsSync(LAUNCH_AGENTS_DIR)) {
    await mkdir(LAUNCH_AGENTS_DIR, { recursive: true });
  }

  await writeFile(PLIST_PATH, getPlist());

  // Load the plist so the heartbeat starts immediately
  try {
    await new Promise<void>((resolve, reject) => {
      execFile("launchctl", ["load", PLIST_PATH], (err) => (err ? reject(err) : resolve()));
    });
  } catch {
    // Non-fatal: plist will be loaded on next login
  }

  return true;
}

export function isHeartbeatInstalled(): boolean {
  return existsSync(PLIST_PATH);
}

export function getHeartbeatPath(): string {
  return PLIST_PATH;
}
