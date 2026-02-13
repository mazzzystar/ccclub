import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

const CLAUDE_SETTINGS_DIR = join(homedir(), ".claude");
const CLAUDE_SETTINGS_PATH = join(CLAUDE_SETTINGS_DIR, "settings.json");

const HOOK_COMMAND = "ccclub sync --silent";
const HOOK_EVENTS = ["SessionEnd", "Stop"] as const;

interface ClaudeSettings {
  hooks?: Record<string, unknown[]>;
  [key: string]: unknown;
}

function eventHasOurHook(settings: ClaudeSettings, event: string): boolean {
  const hooks = settings.hooks?.[event];
  if (!Array.isArray(hooks)) return false;

  return hooks.some((group: unknown) => {
    const g = group as { matcher?: string; hooks?: Array<{ command?: string }> };
    return g.matcher !== undefined && g.hooks?.some((h) => h.command === HOOK_COMMAND);
  });
}

function hasAllHooks(settings: ClaudeSettings): boolean {
  return HOOK_EVENTS.every((event) => eventHasOurHook(settings, event));
}

function installEventHook(settings: ClaudeSettings, event: string): void {
  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = [];

  // Remove old entries without matcher field
  settings.hooks[event] = (settings.hooks[event] as Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>).filter(
    (g) => !(g.hooks?.some((h) => h.command === HOOK_COMMAND) && g.matcher === undefined),
  );

  // Skip if already present with matcher
  if (eventHasOurHook(settings, event)) return;

  (settings.hooks[event] as unknown[]).push({
    matcher: "",
    hooks: [
      {
        type: "command",
        command: HOOK_COMMAND,
        async: true,
        timeout: 30,
      },
    ],
  });
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

    if (hasAllHooks(settings)) return true;

    for (const event of HOOK_EVENTS) {
      installEventHook(settings, event);
    }

    await writeFile(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
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
    return hasAllHooks(settings);
  } catch {
    return false;
  }
}
