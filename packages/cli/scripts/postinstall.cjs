const fs = require("fs");
const path = require("path");
const os = require("os");

const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
const HOOK_COMMAND = "ccclub sync --silent";

try {
  // Only install hook if user has Claude Code configured
  if (!fs.existsSync(settingsPath)) process.exit(0);

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  if (!settings.hooks) settings.hooks = {};

  const sessionEnd = settings.hooks.SessionEnd || [];
  const hasHook = sessionEnd.some(
    (g) => g.matcher !== undefined && g.hooks?.some((h) => h.command === HOOK_COMMAND),
  );

  if (hasHook) process.exit(0);

  // Remove old format entries (missing matcher field)
  settings.hooks.SessionEnd = sessionEnd.filter(
    (g) => !(g.hooks?.some((h) => h.command === HOOK_COMMAND) && g.matcher === undefined),
  );

  settings.hooks.SessionEnd.push({
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

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
} catch {
  // Silent fail — hook can be installed later via `ccclub hook`
}
