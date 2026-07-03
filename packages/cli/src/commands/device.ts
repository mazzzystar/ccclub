import chalk from "chalk";
import ora from "ora";
import type { DeviceLinkCodeResponse } from "@ccclub/shared";
import { requireConfig } from "../config.js";
import { formatFetchError } from "../fetch-error.js";
import { theme } from "../theme.js";

export async function deviceLinkCommand(): Promise<void> {
  const config = await requireConfig();
  const spinner = ora("Creating device link code...").start();

  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}/api/device/link-code`, {
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

  const data = (await res.json()) as DeviceLinkCodeResponse;
  spinner.succeed("Device link code created");
  console.log("");
  console.log(chalk.bold("  On the other terminal, run:"));
  console.log("");
  console.log(`    ${theme.text(`ccclub link ${data.code}`)}`);
  console.log("");
  console.log(chalk.dim(`  This one-time code expires at ${new Date(data.expiresAt).toLocaleString()}.`));
}
