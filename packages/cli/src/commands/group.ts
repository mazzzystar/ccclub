import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import ora from "ora";
import { requireConfig, saveConfig } from "../config.js";
export async function createGroupCommand(): Promise<void> {
  const config = await requireConfig();
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const name = await rl.question(chalk.bold("Group name: "));
    if (!name.trim()) {
      console.error(chalk.red("Name cannot be empty"));
      return;
    }

    const spinner = ora("Creating group...").start();

    let res: Response;
    try {
      res = await fetch(`${config.apiUrl}/api/group/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({ name: name.trim() }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      spinner.fail(`Failed: ${err instanceof Error ? err.message : err}`);
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      spinner.fail(`Failed: ${(err as { error: string }).error}`);
      return;
    }

    const data = (await res.json()) as { groupCode: string; groupName: string };

    // Save new group to config
    if (!config.groups.includes(data.groupCode)) {
      config.groups.push(data.groupCode);
      await saveConfig(config);
    }

    spinner.succeed(`Created "${data.groupName}"`);
    console.log(chalk.bold(`\n  Invite code: `) + chalk.cyan.bold(data.groupCode));
    console.log(chalk.dim(`  Share: npm i -g ccclub && ccclub join ${data.groupCode}`));
    console.log(chalk.dim(`  Dashboard: ${config.apiUrl}/g/${data.groupCode}`));
  } finally {
    rl.close();
  }
}
