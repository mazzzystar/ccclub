import chalk from "chalk";
import ora from "ora";
import { generateDeviceId, generateDeviceToken, getApiUrl, loadConfig, saveConfig } from "../config.js";
import { installHook } from "../hook.js";
import { installHeartbeat } from "../heartbeat.js";
import { doSync } from "./sync.js";
import { ensureGlobalInstall } from "../global-install.js";
import { formatFetchError } from "../fetch-error.js";
import type { CliConfig } from "../config.js";
import type { DeviceLinkResponse } from "@ccclub/shared";

export function createLinkedConfig(input: {
  apiUrl: string;
  token: string;
  deviceId: string;
  response: DeviceLinkResponse;
}): CliConfig {
  return {
    apiUrl: input.apiUrl,
    token: input.token,
    userId: input.response.userId,
    displayName: input.response.displayName,
    groups: input.response.groups,
    deviceId: input.deviceId,
  };
}

export async function linkCommand(code: string | undefined): Promise<void> {
  if (!code) {
    console.log(`\n  Usage:  ccclub link <code>\n\n  Generate a code on another terminal:\n    ccclub device link\n`);
    return;
  }

  const existing = await loadConfig();
  if (existing) {
    console.log(chalk.yellow("Already initialized on this terminal."));
    console.log(chalk.dim("  To link a fresh terminal, run this command where ccclub is not initialized yet."));
    return;
  }

  const apiUrl = getApiUrl();
  const token = generateDeviceToken();
  const deviceId = generateDeviceId();
  const spinner = ora("Linking device...").start();

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/device/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, token, deviceId }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    spinner.fail(`Link failed: ${formatFetchError(err)}`);
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    spinner.fail(`Link failed: ${(err as { error: string }).error}`);
    return;
  }

  const data = (await res.json()) as DeviceLinkResponse;
  await saveConfig(createLinkedConfig({ apiUrl, token, deviceId, response: data }));

  await Promise.all([installHook(), installHeartbeat()]);
  spinner.succeed(`Linked as ${data.displayName}`);

  console.log("");
  await doSync(true);
  await ensureGlobalInstall();

  console.log("");
  console.log(chalk.dim("  Run ") + chalk.white("ccclub") + chalk.dim(" to see the leaderboard."));
}
