import { readFileSync } from "node:fs";
import chalk from "chalk";
import { theme } from "../theme.js";
import { renderStatusline } from "../statusline.js";
import {
  STATUSLINE_COMMAND,
  clearOptOut,
  getStatuslineState,
  installStatusline,
  setOptOut,
  uninstallStatusline,
} from "../statusline-install.js";
import { isGloballyInstalled } from "../global-install.js";

export async function statuslineCommand(action?: string): Promise<void> {
  switch (action) {
    case "on": {
      const state = await getStatuslineState();
      if (state === "other") {
        console.log(theme.warning("\n  Another statusline is already configured in ~/.claude/settings.json."));
        console.log(chalk.dim("  ccclub won't overwrite it. Remove it first if you want ccclub's statusline.\n"));
        return;
      }
      if (!(await isGloballyInstalled())) {
        console.log(theme.warning("\n  ccclub is not installed globally, so Claude Code can't run the statusline."));
        console.log(chalk.dim("  Run: ") + theme.text("npm install -g ccclub") + chalk.dim(" and try again.\n"));
        return;
      }
      await clearOptOut();
      if (await installStatusline()) {
        console.log(theme.success("\n  ✓ Statusline enabled") + chalk.dim(" — model · 5h/7d limits · rank"));
        console.log(chalk.dim("  Open a new Claude Code session to see it.\n"));
      } else {
        console.log(theme.danger("\n  Could not update ~/.claude/settings.json (invalid JSON?).\n"));
      }
      return;
    }

    case "off": {
      await setOptOut(); // Remember the choice so nothing auto-enables it again.
      if (await uninstallStatusline()) {
        console.log(theme.success("\n  ✓ Statusline removed") + chalk.dim(' — run "ccclub statusline on" to bring it back.\n'));
      } else {
        console.log(theme.danger("\n  Could not update ~/.claude/settings.json (invalid JSON?).\n"));
      }
      return;
    }

    case undefined: {
      // Piped input (Claude Code or testing): render it. On a TTY: show status.
      if (!process.stdin.isTTY) {
        let input = "";
        try {
          input = readFileSync(0, "utf-8");
        } catch { /* no stdin */ }
        const output = renderStatusline(input);
        if (output) process.stdout.write(output);
        return;
      }

      const state = await getStatuslineState();
      const label = state === "ours"
        ? theme.success("enabled")
        : state === "other"
          ? theme.warning("another statusline is configured")
          : chalk.dim("not configured");
      console.log(`\n  Statusline: ${label}`);
      console.log(chalk.dim(`  Command: ${STATUSLINE_COMMAND}  ·  ccclub statusline on | off\n`));
      return;
    }

    default:
      console.log(`\n  Usage:  ccclub statusline [on|off]\n`);
  }
}
