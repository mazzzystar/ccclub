import { exec } from "node:child_process";
import chalk from "chalk";

function run(cmd: string): Promise<string> {
  return new Promise((resolve) => {
    exec(cmd, (err, stdout) => resolve(err ? "" : stdout.trim()));
  });
}

/**
 * Check if `ccclub` is globally installed (not just available via npx).
 * If not, install it globally so users can run `ccclub rank` directly.
 */
export async function ensureGlobalInstall(): Promise<void> {
  // Check npm global list, not PATH (npx temporarily adds to PATH)
  const globalList = await run("npm list -g ccclub --depth=0");
  if (globalList.includes("ccclub@")) return;

  console.log(chalk.dim("\n  Installing ccclub globally so you can run it directly..."));

  const result = await run("npm install -g ccclub");
  if (result) {
    console.log(chalk.green("  Done!") + chalk.dim(" You can now use ") + chalk.white("ccclub rank") + chalk.dim(" directly."));
  } else {
    console.log(chalk.dim("  Could not auto-install. Run manually:"));
    console.log(chalk.white("    npm install -g ccclub"));
  }
}
