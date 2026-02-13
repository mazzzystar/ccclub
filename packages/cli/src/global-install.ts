import { exec } from "node:child_process";
import chalk from "chalk";

function run(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    exec(cmd, (err) => resolve(!err));
  });
}

/**
 * Check if `ccclub` is already available as a global command.
 * If not, install it globally so users can run `ccclub rank` directly.
 */
export async function ensureGlobalInstall(): Promise<void> {
  if (await run("ccclub --version")) return;

  console.log(chalk.dim("\n  Installing ccclub globally so you can run it directly..."));

  if (await run("npm install -g ccclub")) {
    console.log(chalk.green("  Done!") + chalk.dim(" You can now use ") + chalk.white("ccclub rank") + chalk.dim(" directly."));
  } else {
    console.log(chalk.dim("  Could not auto-install. Run manually:"));
    console.log(chalk.white("    npm install -g ccclub"));
  }
}
