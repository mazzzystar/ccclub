// Runs on every npm install. Re-pins the background entrypoints (Claude Code
// hooks and, on macOS, the heartbeat LaunchAgent) to the version being
// installed, so `npm i -g ccclub@latest` upgrades everything in one command.
// An already-newer pin is left alone: a leftover older package must not
// rewrite 0.9.x back to itself. Without the LaunchAgent half, a still-old
// heartbeat would keep rewriting the hooks back to its own version every 5
// minutes until the user ran ccclub.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
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

const PLIST_NAME = "dev.ccclub.sync";
const PLIST_PATH = path.join(os.homedir(), "Library", "LaunchAgents", `${PLIST_NAME}.plist`);

const PINNED_PACKAGE = /ccclub@([0-9A-Za-z][0-9A-Za-z.+-]*)/;
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

const isManagedHookCommand = (command) =>
  typeof command === "string" &&
  (LEGACY_HOOK_COMMANDS.has(command) || VERSIONED_HOOK_COMMAND.test(command));

// Mirror of packages/cli/src/pin-version.ts. pin-version.test.ts asserts the
// two comparators stay in lockstep — a drift would reintroduce the downgrade
// loop this script exists to close on `npm i -g`.
function extractPinnedVersion(text) {
  const match = typeof text === "string" ? text.match(PINNED_PACKAGE) : null;
  return match ? match[1] : null;
}

function parseNpmVersion(version) {
  const match = VERSION.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split(".") : null,
  };
}

function comparePreRelease(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const left = a[i];
    const right = b[i];
    if (left == null) return -1;
    if (right == null) return 1;
    const leftNum = /^\d+$/.test(left) ? Number(left) : null;
    const rightNum = /^\d+$/.test(right) ? Number(right) : null;
    if (leftNum != null && rightNum != null) {
      if (leftNum !== rightNum) return leftNum - rightNum;
      continue;
    }
    if (leftNum != null) return -1;
    if (rightNum != null) return 1;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

function compareNpmVersions(a, b) {
  const left = parseNpmVersion(a);
  const right = parseNpmVersion(b);
  if (!left || !right) return null;
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  if (left.pre == null && right.pre == null) return 0;
  if (left.pre == null) return 1;
  if (right.pre == null) return -1;
  return comparePreRelease(left.pre, right.pre);
}

function isNewerPin(installed, current) {
  if (installed == null) return false;
  const cmp = compareNpmVersions(installed, current);
  return cmp != null && cmp > 0;
}

function shouldKeepExistingPlist(existing, version) {
  if (existing === buildPlist(version)) return true;
  return isNewerPin(extractPinnedVersion(existing), version);
}

// Mirror of the hook group installEventHook writes in src/hook.ts (an ESM
// module this CJS script can't import). The timeout must equal that file's
// HOOK_TIMEOUT_SECONDS: 30 killed a first cold scan before the scan cache was
// written, so the next hook started from nothing and was killed again.
// hook.test.ts asserts the two groups stay deep-equal.
const HOOK_TIMEOUT_SECONDS = 120;

function buildHookGroup(version) {
  return {
    matcher: "",
    hooks: [
      {
        type: "command",
        command: `npx --yes ccclub@${version} sync --silent`,
        async: true,
        timeout: HOOK_TIMEOUT_SECONDS,
      },
    ],
  };
}

function updateHooks() {
  // Only install hooks if the user has Claude Code configured.
  if (!fs.existsSync(settingsPath)) return;

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  if (!settings.hooks) settings.hooks = {};

  let changed = false;

  for (const event of HOOK_EVENTS) {
    const eventHooks = settings.hooks[event] || [];
    const managed = eventHooks.flatMap((g) =>
      (g && typeof g === "object" && Array.isArray(g.hooks) ? g.hooks : [])
        .filter((h) => h && typeof h === "object" && isManagedHookCommand(h.command))
        .map((h) => ({ command: h.command, hasMatcher: g.matcher !== undefined })),
    );
    if (
      managed.length === 1 &&
      managed[0].command === HOOK_COMMAND &&
      managed[0].hasMatcher
    ) continue;

    // A leftover older package must not pin hooks backward over a newer CLI.
    if (managed.some((m) => isNewerPin(extractPinnedVersion(m.command), pkg.version))) continue;

    // Remove every ccclub-managed hook while preserving unrelated commands
    // that happen to share the same group.
    settings.hooks[event] = eventHooks.flatMap((g) => {
      if (!g || typeof g !== "object") return [g];
      if (!Array.isArray(g.hooks)) return [g];
      const hooks = g.hooks.filter((h) => !isManagedHookCommand(h && typeof h === "object" ? h.command : undefined));
      return hooks.length > 0 ? [{ ...g, hooks }] : [];
    });

    settings.hooks[event].push(buildHookGroup(pkg.version));

    changed = true;
  }

  if (changed) {
    atomicWrite(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  }
}

// Mirror of atomicWriteFile in src/fs-utils.ts: Claude Code reads
// settings.json while we write, and a plain write truncates first.
function atomicWrite(target, data) {
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, target);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean up */ }
    throw err;
  }
}

function xmlEscape(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Mirror of getPlist in src/heartbeat.ts (an ESM module this CJS script can't
// import). heartbeat.test.ts asserts the two stay byte-identical — a drift
// would only cause one harmless rewrite on the next sync, but keep them same.
function buildPlist(version) {
  const logPath = path.join(os.homedir(), ".ccclub", "sync.log");
  const pathEnv = `${path.dirname(process.execPath)}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`;
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

function updateHeartbeat() {
  // Only refresh an EXISTING heartbeat: whether one should exist at all is
  // init/join/sync's decision, not npm's.
  if (process.platform !== "darwin") return;
  if (!fs.existsSync(PLIST_PATH)) return;

  const plist = buildPlist(pkg.version);
  const existing = fs.readFileSync(PLIST_PATH, "utf-8");
  if (shouldKeepExistingPlist(existing, pkg.version)) return;

  atomicWrite(PLIST_PATH, plist);
  // Reload so launchd picks up the new pin now; failures (SSH session, CI)
  // self-heal at next login via RunAtLoad.
  for (const action of ["unload", "load"]) {
    try {
      execFileSync("launchctl", [action, PLIST_PATH], { stdio: "ignore", timeout: 10000 });
    } catch { /* non-fatal */ }
  }
}

function main() {
  // Each step fails silently and independently — a broken settings.json must
  // not break `npm install`, and hooks can be repaired later via ccclub.
  try { updateHooks(); } catch { /* ignore */ }
  try { updateHeartbeat(); } catch { /* ignore */ }
}

module.exports = {
  buildPlist,
  buildHookGroup,
  updateHooks,
  updateHeartbeat,
  PLIST_NAME,
  extractPinnedVersion,
  compareNpmVersions,
  isNewerPin,
  shouldKeepExistingPlist,
};

if (require.main === module) main();
