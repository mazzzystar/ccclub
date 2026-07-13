import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir, userInfo } from "node:os";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { CCCLUB_CONFIG_DIR, DEFAULT_API_URL } from "@ccclub/shared";

export interface CliConfig {
  apiUrl: string;
  token: string;        // device token
  userId: string;
  displayName: string;
  groups: string[];      // invite codes
}

function getConfigDir(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR);
}

function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function getLastSyncPath(): string {
  return join(getConfigDir(), "last-sync");
}

export function getLastSyncTimePath(): string {
  return join(getConfigDir(), "last-sync-time");
}

export async function loadConfig(): Promise<CliConfig | null> {
  const path = getConfigPath();
  if (!existsSync(path)) return null;
  const content = await readFile(path, "utf-8");
  return JSON.parse(content);
}

export async function saveConfig(config: CliConfig): Promise<void> {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }
  await writeFile(getConfigPath(), JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function generateDeviceToken(): string {
  return randomBytes(32).toString("hex");
}

export function getApiUrl(): string {
  return process.env.CCCLUB_API_URL || DEFAULT_API_URL;
}

export function getDefaultDisplayName(): string | null {
  // 1. Try git global user name
  try {
    const name = execSync("git config --global user.name", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (name) return name;
  } catch {
    // git not available or not configured
  }

  // 2. Try macOS full name
  try {
    const name = execSync("id -F", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (name) return name;
  } catch {
    // Not macOS or command failed
  }

  // 3. Fall back to OS username
  try {
    const name = userInfo().username;
    if (name) return name;
  } catch {
    // userInfo() can throw on some platforms
  }

  return null;
}

export async function requireConfig(): Promise<CliConfig> {
  const config = await loadConfig();
  if (!config) {
    console.error('Not initialized. Run "ccclub init" or "ccclub join <code>" first.');
    process.exit(1);
  }
  return config;
}
