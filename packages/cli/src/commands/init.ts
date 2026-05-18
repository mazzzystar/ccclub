import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, saveConfig, generateDeviceToken, getApiUrl, getDefaultDisplayName } from "../config.js";
import { installHook, isHookInstalled } from "../hook.js";
import { doSync } from "./sync.js";
import { ensureGlobalInstall } from "../global-install.js";
import { formatFetchError } from "../fetch-error.js";
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
    console.log(chalk.dim('\n  Run "ccclub" to see the leaderboard'));
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
      spinner.fail(`Setup failed: ${formatFetchError(err)}`);
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
    spinner.succeed("ccclub initialized!");

    if (!hookOk) {
      console.log(chalk.dim('  Tip: run "ccclub hook" to set up auto-sync'));
    }
    console.log("");
    console.log(chalk.bold("  Invite friends to compete:"));
    console.log("");
    console.log(`    ${chalk.cyan.underline(`${apiUrl}/invite/${data.groupCode}`)}`);
    console.log("");
    console.log(chalk.dim(`    or: npx ccclub join ${data.groupCode}`));

    // First sync
    console.log("");
    await doSync(true);

    // Auto-install globally so `ccclub` works without npx
    await ensureGlobalInstall();

    printQuickStart();

  } finally {
    rl.close();
  }
}

function printQuickStart(): void {
  console.log("");
  console.log(chalk.dim("  Run ") + chalk.white("ccclub") + chalk.dim(" to see the leaderboard. ") + chalk.white("ccclub -h") + chalk.dim(" for all commands."));
  console.log("");
}
