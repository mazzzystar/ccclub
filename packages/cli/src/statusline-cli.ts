// Entry point for the `ccclub-statusline` binary that Claude Code invokes on
// every turn (configured in ~/.claude/settings.json by `ccclub init`).
// Deliberately separate from the main CLI so startup skips commander/chalk/ora.
import { readFileSync } from "node:fs";
import { renderStatusline } from "./statusline.js";

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
