import { exec } from "node:child_process";
import chalk from "chalk";
import { theme } from "./theme.js";

function run(cmd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(cmd, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: (stdout ?? "").trim(), stderr: (stderr ?? "").trim() }),
    );
  });
}

/** Check npm's global list, not PATH (npx temporarily adds itself to PATH). */
export async function isGloballyInstalled(): Promise<boolean> {
  const result = await run("npm list -g ccclub --depth=0");
  return result.stdout.includes("ccclub@");
}

/**
 * Check if `ccclub` is globally installed (not just available via npx).
 * If not, install it globally so users can run `ccclub` directly.
 * Returns true when the global install is present afterwards.
 *
 * Failures print npm's actual error: this used to swallow everything, and a
 * machine whose one `npm install -g` failed here also lost its statusline
 * with no trace of why.
 */
export async function ensureGlobalInstall(): Promise<boolean> {
  if (await isGloballyInstalled()) return true;

  console.log(chalk.dim("\n  Installing ccclub globally so you can run it directly..."));

  const result = await run("npm install -g ccclub");
  if (result.ok) {
    console.log(theme.success("  Done!") + chalk.dim(" You can now use ") + theme.text("ccclub") + chalk.dim(" directly."));
    return true;
  }
  console.log(theme.warning("  Could not install globally:"));
  for (const line of result.stderr.split("\n").filter(Boolean).slice(-3)) {
    console.log(chalk.dim(`    ${line}`));
  }
  console.log(chalk.dim("  Run manually: ") + theme.text("npm install -g ccclub"));
  console.log(chalk.dim("  (background sync retries the statusline setup once this succeeds)"));
  return false;
}
