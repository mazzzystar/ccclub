import chalk from "chalk";
import { installHook, isHookInstalled, newerPinnedHookVersion } from "../hook.js";
import { getCurrentVersion } from "../version.js";

export async function hookCommand(): Promise<void> {
  const version = getCurrentVersion();
  // A pin ahead of this binary is what the automatic paths refuse to touch.
  // Running this command by hand is the escape hatch out of it, so it must
  // not report "already set up" and change nothing.
  const pinnedAhead = newerPinnedHookVersion(version);

  if (pinnedAhead == null && isHookInstalled()) {
    console.log(chalk.green("  Auto-sync is already set up."));
    console.log(chalk.dim("  Usage syncs automatically when sessions end."));
    return;
  }

  const ok = await installHook({ force: true });
  if (ok) {
    console.log(chalk.green("  Auto-sync installed!"));
    console.log(chalk.dim("  Usage will sync automatically when sessions end."));
  } else {
    console.log(chalk.red("  Failed to set up auto-sync."));
    console.log(chalk.dim("  Try running the command again, or see https://ccclub.dev for help."));
  }
}
