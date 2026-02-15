import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, saveConfig, generateDeviceToken, getApiUrl, getDefaultDisplayName } from "../config.js";
import { installHook, isHookInstalled } from "../hook.js";
import { doSync } from "./sync.js";
import { ensureGlobalInstall } from "../global-install.js";
import type { InitResponse } from "@ccclub/shared";

export async function initCommand(): Promise<void> {
  const existing = await loadConfig();
  if (existing) {
    console.log(chalk.yellow("Already initialized!"));
    console.log(`  User: ${existing.displayName}`);
    console.log(`  Groups: ${existing.groups.join(", ") || "(none)"}`);
    // Ensure hook is installed for users who initialized before hook support
    if (!isHookInstalled()) {
      const hookOk = await installHook();
      if (hookOk) console.log(chalk.green("  Auto-sync hook installed!"));
    }
    console.log(chalk.dim('\n  Run "ccclub" to see rankings'));
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const defaultName = getDefaultDisplayName();
    const prompt = defaultName
      ? chalk.bold(`Your display name (${defaultName}): `)
      : chalk.bold("Your display name: ");
    const input = await rl.question(prompt);
    const displayName = input.trim() || defaultName || "";
    if (!displayName) {
      console.error(chalk.red("Name cannot be empty"));
      return;
    }

    const spinner = ora("Setting up...").start();

    const token = generateDeviceToken();
    const apiUrl = getApiUrl();

    let res: Response;
    try {
      res = await fetch(`${apiUrl}/api/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, displayName }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      spinner.fail(`Setup failed: ${err instanceof Error ? err.message : err}`);
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      spinner.fail(`Setup failed: ${(err as { error: string }).error}`);
      return;
    }

    const data = (await res.json()) as InitResponse;

    await saveConfig({
      apiUrl,
      token,
      userId: data.userId,
      displayName: displayName.trim(),
      groups: [data.groupCode],
    });

    // Install Claude Code hook (silent, best-effort)
    const hookOk = await installHook();
    spinner.succeed("CCClub initialized!");

    console.log("");
    console.log(chalk.bold("  Your invite code:"));
    console.log(chalk.cyan.bold(`\n    ${data.groupCode}\n`));
    console.log(chalk.dim("  Share with friends: ") + chalk.white(`npx ccclub join ${data.groupCode}`));

    if (hookOk) {
      console.log(chalk.dim("  Auto-sync: on (via Claude Code hook)"));
    } else {
      console.log(chalk.dim('  Tip: run "ccclub hook" to set up auto-sync'));
    }

    // First sync
    console.log("");
    await doSync(true);

    // Auto-install globally so `ccclub` works without npx
    await ensureGlobalInstall();

    printQuickStart(data.groupCode);

  } finally {
    rl.close();
  }
}

function printQuickStart(groupCode: string): void {
  console.log("");
  console.log(chalk.bold("  What's next?"));
  console.log("");
  console.log(chalk.dim("  See the leaderboard:"));
  console.log(chalk.white("    ccclub"));
  console.log("");
  console.log(chalk.dim("  Last 7 days / 30 days / all time:"));
  console.log(chalk.white("    ccclub -d 7"));
  console.log("");
  console.log(chalk.dim("  Open the dashboard in browser:"));
  console.log(chalk.white(`    https://ccclub.dev/g/${groupCode}`));
  console.log("");
  console.log(chalk.dim("  Check what data gets uploaded:"));
  console.log(chalk.white("    ccclub show-data"));
  console.log("");
}
