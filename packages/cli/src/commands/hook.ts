import chalk from "chalk";
import { installHook, isHookInstalled, newerPinnedHookVersion } from "../hook.js";
import { installHeartbeat, newerPinnedHeartbeatVersion } from "../heartbeat.js";
import { pinNotice } from "../pin-version.js";
import { getCurrentVersion } from "../version.js";

export async function hookCommand(): Promise<void> {
  const version = getCurrentVersion();
  // A pin ahead of this binary is what the automatic paths refuse to touch,
  // and both entrypoints carry one. Running this command by hand is the escape
  // hatch out of it — the sync path's notice points here — so it has to cover
  // both, and must not report "already set up" while changing nothing.
  const pinnedAhead = newerPinnedHeartbeatVersion(version) ?? newerPinnedHookVersion(version);

  if (pinnedAhead == null && isHookInstalled()) {
    console.log(chalk.green("  Auto-sync is already set up."));
    console.log(chalk.dim("  Usage syncs automatically when sessions end."));
    return;
  }

  const ok = await installHook({ force: true });
  // The LaunchAgent carries the same pin and needs the same escape hatch.
  // There is no heartbeat off macOS, so skip it silently there.
  if (process.platform === "darwin") await installHeartbeat({ force: true });

  if (ok) {
    const notice = pinNotice(pinnedAhead, version, true);
    if (notice) {
      console.log(chalk.green("  Auto-sync updated!"));
      console.log(chalk.dim(`  ${notice}`));
    } else {
      console.log(chalk.green("  Auto-sync installed!"));
      console.log(chalk.dim("  Usage will sync automatically when sessions end."));
    }
  } else {
    console.log(chalk.red("  Failed to set up auto-sync."));
    console.log(chalk.dim("  Try running the command again, or see https://ccclub.dev for help."));
  }
}
