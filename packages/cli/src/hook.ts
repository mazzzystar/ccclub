import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

const CLAUDE_SETTINGS_DIR = join(homedir(), ".claude");
const CLAUDE_SETTINGS_PATH = join(CLAUDE_SETTINGS_DIR, "settings.json");

const HOOK_COMMAND = "ccclub sync --silent";

interface ClaudeSettings {
  hooks?: Record<string, unknown[]>;
  [key: string]: unknown;
}

function hasOurHook(settings: ClaudeSettings): boolean {
  const sessionEndHooks = settings.hooks?.SessionEnd;
  if (!Array.isArray(sessionEndHooks)) return false;

  return sessionEndHooks.some((group: unknown) => {
    const g = group as { matcher?: string; hooks?: Array<{ command?: string }> };
    // Must have matcher field to be valid (old versions omitted it)
    return g.matcher !== undefined && g.hooks?.some((h) => h.command === HOOK_COMMAND);
  });
}

export async function installHook(): Promise<boolean> {
  try {
    // Ensure ~/.claude exists
    if (!existsSync(CLAUDE_SETTINGS_DIR)) {
      await mkdir(CLAUDE_SETTINGS_DIR, { recursive: true });
    }

    // Read existing settings
    let settings: ClaudeSettings = {};
    if (existsSync(CLAUDE_SETTINGS_PATH)) {
      const raw = await readFile(CLAUDE_SETTINGS_PATH, "utf-8");
      settings = JSON.parse(raw);
    }

    // Already installed
    if (hasOurHook(settings)) return true;

    // Merge our hook
    if (!settings.hooks) settings.hooks = {};
    if (!Array.isArray(settings.hooks.SessionEnd)) settings.hooks.SessionEnd = [];

    // Remove old entries without matcher field
    settings.hooks.SessionEnd = (settings.hooks.SessionEnd as Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>).filter(
      (g) => !(g.hooks?.some((h) => h.command === HOOK_COMMAND) && g.matcher === undefined),
    );

    (settings.hooks.SessionEnd as unknown[]).push({
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

    await writeFile(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
    return true;
  } catch {
    return false;
  }
}

export function isHookInstalled(): boolean {
  try {
    if (!existsSync(CLAUDE_SETTINGS_PATH)) return false;
    // Sync read for quick check — not ideal but simple
    const raw = require("node:fs").readFileSync(CLAUDE_SETTINGS_PATH, "utf-8");
    const settings = JSON.parse(raw) as ClaudeSettings;
    return hasOurHook(settings);
  } catch {
    return false;
  }
}
