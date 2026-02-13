import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, saveConfig, generateDeviceToken, getApiUrl, getDefaultDisplayName } from "../config.js";
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
    // New user, ask for name (with auto-detected default)
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const defaultName = getDefaultDisplayName();
      const prompt = defaultName
        ? chalk.bold(`Your display name (${defaultName}): `)
        : chalk.bold("Your display name: ");
      const input = await rl.question(prompt);
      displayName = input.trim() || defaultName || "";
      if (!displayName) {
        console.error(chalk.red("Name cannot be empty"));
        return;
      }
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

  // First sync if new user
  if (!config) {
    console.log("");
    await doSync(true);
  }

  console.log("");
  console.log(chalk.bold("  What's next?"));
  console.log("");
  console.log(chalk.dim("  See the leaderboard:"));
  console.log(chalk.white("    ccclub"));
  console.log("");
  console.log(chalk.dim("  This week / this month / all-time:"));
  console.log(chalk.white("    ccclub -p weekly"));
  console.log("");
  console.log(chalk.dim("  Open the dashboard in browser:"));
  console.log(chalk.white(`    https://ccclub.dev/g/${data.groupCode}`));
  console.log("");
}
