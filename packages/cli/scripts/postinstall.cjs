const fs = require("fs");
const path = require("path");
const os = require("os");
const pkg = require("../package.json");

const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
const HOOK_COMMAND = `npx --yes ccclub@${pkg.version} sync --silent`;
const LEGACY_HOOK_COMMANDS = new Set([
  "ccclub sync --silent",
  "npx ccclub sync --silent",
  "npx --yes ccclub sync --silent",
  "npx ccclub@latest sync --silent",
  "npx --yes ccclub@latest sync --silent",
]);
const VERSIONED_HOOK_COMMAND = /^npx --yes ccclub@[0-9A-Za-z][0-9A-Za-z.+-]* sync --silent$/u;
const HOOK_EVENTS = ["SessionEnd", "Stop"];
const isManagedHookCommand = (command) =>
  typeof command === "string" &&
  (LEGACY_HOOK_COMMANDS.has(command) || VERSIONED_HOOK_COMMAND.test(command));

try {
  // Only install hook if user has Claude Code configured
  if (!fs.existsSync(settingsPath)) process.exit(0);

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  if (!settings.hooks) settings.hooks = {};

  let changed = false;

  for (const event of HOOK_EVENTS) {
    const eventHooks = settings.hooks[event] || [];
    const managed = eventHooks.flatMap((g) =>
      (g && typeof g === "object" && Array.isArray(g.hooks) ? g.hooks : [])
        .filter((h) => isManagedHookCommand(h.command))
        .map((h) => ({ command: h.command, hasMatcher: g.matcher !== undefined })),
    );
    if (
      managed.length === 1 &&
      managed[0].command === HOOK_COMMAND &&
      managed[0].hasMatcher
    ) continue;

    // Remove every ccclub-managed hook while preserving unrelated commands
    // that happen to share the same group.
    settings.hooks[event] = eventHooks.flatMap((g) => {
      if (!g || typeof g !== "object") return [g];
      if (!Array.isArray(g.hooks)) return [g];
      const hooks = g.hooks.filter((h) => !isManagedHookCommand(h.command));
      return hooks.length > 0 ? [{ ...g, hooks }] : [];
    });

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
