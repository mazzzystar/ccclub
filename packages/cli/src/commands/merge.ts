import chalk from "chalk";
import ora from "ora";
import type { AccountMergeCodeResponse, AccountMergeResponse } from "@ccclub/shared";
import { requireConfig, saveConfig } from "../config.js";
import type { CliConfig } from "../config.js";
import { formatFetchError } from "../fetch-error.js";
import { theme } from "../theme.js";

export function createMergedConfig(existing: CliConfig, response: AccountMergeResponse): CliConfig {
  return {
    ...existing,
    userId: response.userId,
    displayName: response.displayName,
    groups: response.groups,
  };
}

export async function mergeCodeCommand(): Promise<void> {
  const config = await requireConfig();
  const spinner = ora("Creating account merge code...").start();

  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}/api/account/merge-code`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    spinner.fail(`Failed: ${formatFetchError(err)}`);
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    spinner.fail(`Failed: ${(err as { error: string }).error}`);
    return;
  }

  const data = (await res.json()) as AccountMergeCodeResponse;
  spinner.succeed("Account merge code created");
  console.log("");
  console.log(chalk.bold("  On the account you want to merge into this one, run:"));
  console.log("");
  console.log(`    ${theme.text(`ccclub merge ${data.code}`)}`);
  console.log("");
  console.log(chalk.dim(`  This one-time code expires at ${new Date(data.expiresAt).toLocaleString()}.`));
  console.log(chalk.dim("  The account that created this code remains the displayed profile."));
}

export async function mergeCommand(code: string | undefined): Promise<void> {
  if (!code) {
    console.log(`\n  Usage:  ccclub merge <code>\n\n  Generate a code on the account to keep:\n    ccclub merge-code\n`);
    return;
  }

  const config = await requireConfig();
  const spinner = ora("Merging account...").start();

  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}/api/account/merge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    spinner.fail(`Merge failed: ${formatFetchError(err)}`);
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    spinner.fail(`Merge failed: ${(err as { error: string }).error}`);
    return;
  }

  const data = (await res.json()) as AccountMergeResponse;
  await saveConfig(createMergedConfig(config, data));
  spinner.succeed(`Merged into ${data.displayName}`);

  console.log("");
  console.log(chalk.dim("  Future leaderboard rows will use the kept account's profile."));
  console.log(chalk.dim("  Existing usage stays in place and is merged when rankings are read."));
}
