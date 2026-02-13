import chalk from "chalk";
import { installHook, isHookInstalled } from "../hook.js";

export async function hookCommand(): Promise<void> {
  if (isHookInstalled()) {
    console.log(chalk.green("  Claude Code hook already installed."));
    console.log(chalk.dim("  Usage syncs automatically when each Claude Code session ends."));
    return;
  }

  const ok = await installHook();
  if (ok) {
    console.log(chalk.green("  Claude Code hook installed!"));
    console.log(chalk.dim("  Usage will sync automatically when each Claude Code session ends."));
  } else {
    console.log(chalk.red("  Failed to install hook."));
    console.log(chalk.dim('  You can manually add to ~/.claude/settings.json:'));
    console.log(chalk.dim('  {"hooks":{"SessionEnd":[{"hooks":[{"type":"command","command":"ccclub sync --silent","async":true}]}]}}'));
  }
}
