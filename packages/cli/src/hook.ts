import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { extractPinnedVersion, isNewerPin } from "./pin-version.js";
import { getCurrentVersion } from "./version.js";
import { atomicWriteFile } from "./fs-utils.js";

const CLAUDE_SETTINGS_DIR = join(homedir(), ".claude");
const CLAUDE_SETTINGS_PATH = join(CLAUDE_SETTINGS_DIR, "settings.json");

const LEGACY_HOOK_COMMANDS = new Set([
  "ccclub sync --silent",
  "npx ccclub sync --silent",
  "npx --yes ccclub sync --silent",
  "npx ccclub@latest sync --silent",
  "npx --yes ccclub@latest sync --silent",
]);
const VERSIONED_HOOK_COMMAND = /^npx --yes ccclub@[0-9A-Za-z][0-9A-Za-z.+-]* sync --silent$/u;
const HOOK_EVENTS = ["SessionEnd", "Stop"] as const;

export interface ClaudeSettings {
  hooks?: Record<string, unknown[]>;
  [key: string]: unknown;
}

function hookCommand(version: string): string {
  return `npx --yes ccclub@${version} sync --silent`;
}

function isManagedHookCommand(command: string | undefined): boolean {
  if (command == null) return false;
  return LEGACY_HOOK_COMMANDS.has(command) || VERSIONED_HOOK_COMMAND.test(command);
}

function eventHasCurrentHook(settings: ClaudeSettings, event: string, currentCommand: string): boolean {
  const hooks = settings.hooks?.[event];
  if (!Array.isArray(hooks)) return false;

  let currentCount = 0;
  for (const group of hooks) {
    const g = (
      group != null && typeof group === "object"
        ? group
        : {}
    ) as { matcher?: string; hooks?: Array<{ command?: string }> };
    for (const hook of g.hooks ?? []) {
      // A null or non-object entry would throw here, and the outer catches
      // would turn that into a permanently silent no-op of hook install.
      if (hook == null || typeof hook !== "object") continue;
      if (!isManagedHookCommand(hook.command)) continue;
      if (g.matcher === undefined || hook.command !== currentCommand) return false;
      currentCount++;
    }
  }
  return currentCount === 1;
}

function managedCommandsForEvent(settings: ClaudeSettings, event: string): string[] {
  const hooks = settings.hooks?.[event];
  if (!Array.isArray(hooks)) return [];

  const commands: string[] = [];
  for (const group of hooks) {
    const g = (
      group != null && typeof group === "object"
        ? group
        : {}
    ) as { hooks?: Array<{ command?: string }> };
    for (const hook of g.hooks ?? []) {
      if (hook == null || typeof hook !== "object") continue;
      if (!isManagedHookCommand(hook.command) || hook.command == null) continue;
      commands.push(hook.command);
    }
  }
  return commands;
}

function shouldRewriteEvent(
  settings: ClaudeSettings,
  event: string,
  version: string,
  currentCommand: string,
): boolean {
  if (eventHasCurrentHook(settings, event, currentCommand)) return false;
  return !managedCommandsForEvent(settings, event).some((command) =>
    isNewerPin(extractPinnedVersion(command), version),
  );
}

function installEventHook(settings: ClaudeSettings, event: string, currentCommand: string): void {
  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = [];

  // Remove all ccclub-managed commands while preserving unrelated hooks that
  // happen to share a group with an older ccclub entry.
  settings.hooks[event] = settings.hooks[event].flatMap((value) => {
    if (value == null || typeof value !== "object") return [value];
    const group = value as {
      matcher?: string;
      hooks?: Array<{ command?: string; [key: string]: unknown }>;
      [key: string]: unknown;
    };
    if (!Array.isArray(group.hooks)) return [group];
    const hooks = group.hooks.filter((hook) => !isManagedHookCommand(hook?.command));
    return hooks.length > 0 ? [{ ...group, hooks }] : [];
  });

  (settings.hooks[event] as unknown[]).push({
    matcher: "",
    hooks: [
      {
        type: "command",
        command: currentCommand,
        async: true,
        timeout: 30,
      },
    ],
  });
}

/** @internal Pure migration helper exported for regression tests. */
export function updateManagedHooks(
  settings: ClaudeSettings,
  version = getCurrentVersion(),
): boolean {
  const currentCommand = hookCommand(version);
  let changed = false;
  for (const event of HOOK_EVENTS) {
    if (!shouldRewriteEvent(settings, event, version, currentCommand)) continue;
    installEventHook(settings, event, currentCommand);
    changed = true;
  }
  return changed;
}

export async function installHook(): Promise<boolean> {
  try {
    if (!existsSync(CLAUDE_SETTINGS_DIR)) {
      await mkdir(CLAUDE_SETTINGS_DIR, { recursive: true });
    }

    let settings: ClaudeSettings = {};
    if (existsSync(CLAUDE_SETTINGS_PATH)) {
      const raw = await readFile(CLAUDE_SETTINGS_PATH, "utf-8");
      settings = JSON.parse(raw);
    }

    if (!updateManagedHooks(settings)) return true;

    await atomicWriteFile(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
    return true;
  } catch {
    return false;
  }
}

export function isHookInstalled(): boolean {
  try {
    if (!existsSync(CLAUDE_SETTINGS_PATH)) return false;
    const raw = readFileSync(CLAUDE_SETTINGS_PATH, "utf-8");
    const settings = JSON.parse(raw) as ClaudeSettings;
    const version = getCurrentVersion();
    const currentCommand = hookCommand(version);
    return HOOK_EVENTS.every((event) => !shouldRewriteEvent(settings, event, version, currentCommand));
  } catch {
    return false;
  }
}
