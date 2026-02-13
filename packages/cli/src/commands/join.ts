import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, saveConfig, generateDeviceToken, getApiUrl } from "../config.js";
import { installHeartbeat } from "../heartbeat.js";
import { doSync } from "./sync.js";
import type { JoinResponse } from "@ccclub/shared";

export async function joinCommand(inviteCode: string): Promise<void> {
  let config = await loadConfig();
  const apiUrl = getApiUrl();
  let token: string;
  let displayName: string;

  if (config) {
    token = config.token;
    displayName = config.displayName;
  } else {
    // New user, ask for name
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      displayName = await rl.question(chalk.bold("Your display name: "));
      if (!displayName.trim()) {
        console.error(chalk.red("Name cannot be empty"));
        return;
      }
      displayName = displayName.trim();
    } finally {
      rl.close();
    }
    token = generateDeviceToken();
  }

  const spinner = ora("Joining group...").start();

  const res = await fetch(`${apiUrl}/api/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, displayName, inviteCode }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    spinner.fail(`Join failed: ${(err as { error: string }).error}`);
    return;
  }

  const data = (await res.json()) as JoinResponse;

  // Save / update config
  if (config) {
    if (!config.groups.includes(data.groupCode)) {
      config.groups.push(data.groupCode);
    }
    await saveConfig(config);
  } else {
    await saveConfig({
      apiUrl,
      token,
      userId: data.userId,
      displayName,
      groups: [data.groupCode],
    });
    await installHeartbeat();
  }

  spinner.succeed(`Joined "${data.groupName}"!`);
  console.log(chalk.dim(`\n  Dashboard: ${apiUrl}/g/${data.groupCode}`));
  console.log(chalk.dim('  Run "ccclub rank" to see rankings'));

  // First sync if new user
  if (!config) {
    console.log("");
    await doSync(true);
  }

}
