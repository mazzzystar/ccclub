import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import ora from "ora";
import type { LeaveResponse } from "@ccclub/shared";
import { requireConfig, saveConfig } from "../config.js";
import { formatFetchError } from "../fetch-error.js";

export async function leaveCommand(code?: string): Promise<void> {
  const config = await requireConfig();

  if (config.groups.length === 0) {
    console.log(chalk.yellow("  You're not in any groups."));
    return;
  }

  // Determine which group to leave
  let targetCode: string;
  if (code) {
    targetCode = code.toUpperCase();
    if (!config.groups.includes(targetCode)) {
      console.log(chalk.red(`  You're not in group ${targetCode}`));
      return;
    }
  } else if (config.groups.length === 1) {
    targetCode = config.groups[0];
  } else {
    // Multiple groups — ask which one
    console.log(chalk.bold("\n  Your groups:\n"));
    for (let i = 0; i < config.groups.length; i++) {
      console.log(`    ${i + 1}. ${config.groups[i]}`);
    }
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const input = await rl.question(chalk.bold("\n  Leave which group? (number): "));
      const idx = parseInt(input.trim(), 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= config.groups.length) {
        console.log(chalk.red("  Invalid selection."));
        return;
      }
      targetCode = config.groups[idx];
    } finally {
      rl.close();
    }
  }

  // Confirm before leaving
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(chalk.bold(`  Leave group ${targetCode}? [y/N] `));
    if (answer.trim().toLowerCase() !== "y") {
      console.log(chalk.dim("  Cancelled."));
      return;
    }
  } finally {
    rl.close();
  }

  const spinner = ora("Leaving group...").start();

  try {
    const res = await fetch(`${config.apiUrl}/api/leave`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({ inviteCode: targetCode }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      spinner.fail(`Failed: ${(err as { error: string }).error}`);
      return;
    }

    const data = (await res.json()) as LeaveResponse;

    // Remove from local config
    config.groups = config.groups.filter((g) => g !== targetCode);
    await saveConfig(config);

    spinner.succeed(`Left "${data.groupName}"`);
  } catch (err) {
    spinner.fail(`Failed: ${formatFetchError(err)}`);
  }
}
