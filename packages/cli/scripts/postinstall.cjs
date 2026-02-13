const fs = require("fs");
const path = require("path");
const os = require("os");

const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
const HOOK_COMMAND = "ccclub sync --silent";
const HOOK_EVENTS = ["SessionEnd", "Stop"];

try {
  // Only install hook if user has Claude Code configured
  if (!fs.existsSync(settingsPath)) process.exit(0);

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  if (!settings.hooks) settings.hooks = {};

  let changed = false;

  for (const event of HOOK_EVENTS) {
    const eventHooks = settings.hooks[event] || [];
    const hasHook = eventHooks.some(
      (g) => g.matcher !== undefined && g.hooks?.some((h) => h.command === HOOK_COMMAND),
    );

    if (hasHook) continue;

    // Remove old format entries (missing matcher field)
    settings.hooks[event] = eventHooks.filter(
      (g) => !(g.hooks?.some((h) => h.command === HOOK_COMMAND) && g.matcher === undefined),
    );

    settings.hooks[event].push({
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

    changed = true;
  }

  if (changed) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  }
} catch {
  // Silent fail — hook can be installed later via `ccclub hook`
}
