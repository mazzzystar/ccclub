import chalk from "chalk";
import { installHook, isHookInstalled } from "../hook.js";

export async function hookCommand(): Promise<void> {
  if (isHookInstalled()) {
    console.log(chalk.green("  Auto-sync is already set up."));
    console.log(chalk.dim("  Usage syncs automatically when sessions end."));
    return;
  }

  const ok = await installHook();
  if (ok) {
    console.log(chalk.green("  Auto-sync installed!"));
    console.log(chalk.dim("  Usage will sync automatically when sessions end."));
  } else {
    console.log(chalk.red("  Failed to set up auto-sync."));
    console.log(chalk.dim("  Try running the command again, or see https://ccclub.dev for help."));
  }
}
