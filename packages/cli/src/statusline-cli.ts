// Entry point for the `ccclub-statusline` binary that Claude Code invokes on
// every turn (configured in ~/.claude/settings.json by `ccclub init`).
// Deliberately separate from the main CLI so startup skips commander/chalk/ora.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderStatusline } from "./statusline.js";
import { maybeTriggerRefresh } from "./statusline-refresh.js";

// Claude Code pipes a JSON payload and closes stdin. When run by hand in a
// terminal there is nothing to render — exit instead of blocking on a TTY.
if (process.stdin.isTTY) {
  process.exit(0);
}

let input = "";
try {
  input = readFileSync(0, "utf-8");
} catch {
  // No stdin available — nothing to render.
}

const output = renderStatusline(input);
if (output) process.stdout.write(output);

// Only after the line is out, and only ever best effort: if the usage cache
// has gone stale — the machine slept through the heartbeat — start a sync in
// the background so the next turn has fresh numbers. The CLI bundle sits next
// to this one (dist/index.js beside dist/statusline-cli.js), so resolve it
// from this file rather than trusting PATH.
try {
  maybeTriggerRefresh({ cliPath: fileURLToPath(new URL("./index.js", import.meta.url)) });
} catch {
  // Unreachable in practice (maybeTriggerRefresh swallows its own failures),
  // but the printed line and the exit code must not depend on that.
}
