import chalk from "chalk";
import { installHook, isHookInstalled } from "../hook.js";

export async function hookCommand(): Promise<void> {
  if (isHookInstalled()) {
    console.log(chalk.green("  Claude Code hooks already installed."));
    console.log(chalk.dim("  Usage syncs on session end and periodically during sessions (every 5 min)."));
    return;
  }

  const ok = await installHook();
  if (ok) {
    console.log(chalk.green("  Claude Code hooks installed!"));
    console.log(chalk.dim("  Usage will sync on session end and periodically during sessions (every 5 min)."));
  } else {
    console.log(chalk.red("  Failed to install hooks."));
    console.log(chalk.dim('  You can manually add to ~/.claude/settings.json'));
  }
}
