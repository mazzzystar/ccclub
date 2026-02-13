import chalk from "chalk";
import ora from "ora";
import type { ProfileResponse } from "@ccclub/shared";
import { requireConfig, saveConfig } from "../config.js";

export async function profileCommand(options: {
  name?: string;
  avatar?: string;
  public?: boolean;
  private?: boolean;
}): Promise<void> {
  const config = await requireConfig();

  const hasUpdate = options.name !== undefined || options.avatar !== undefined || options.public || options.private;

  if (!hasUpdate) {
    // Show current profile
    const spinner = ora("Fetching profile...").start();
    try {
      const res = await fetch(`${config.apiUrl}/api/profile`, {
        headers: { Authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        spinner.fail("Failed to fetch profile");
        return;
      }
      const profile = (await res.json()) as ProfileResponse;
      spinner.stop();

      console.log(chalk.bold("\n  Your Profile"));
      console.log(`  Name:       ${profile.displayName}`);
      console.log(`  Avatar:     ${profile.avatar || chalk.dim("(default)")}`);
      console.log(`  Visibility: ${profile.visibility === "public" ? chalk.green("public") : chalk.dim("private")}`);
      console.log();
    } catch (err) {
      spinner.fail(`Error: ${err instanceof Error ? err.message : err}`);
    }
    return;
  }

  // Build update payload
  const body: Record<string, string> = {};
  if (options.name !== undefined) body.displayName = options.name;
  if (options.avatar !== undefined) body.avatar = options.avatar;
  if (options.public) body.visibility = "public";
  if (options.private) body.visibility = "private";

  const spinner = ora("Updating profile...").start();
  try {
    const res = await fetch(`${config.apiUrl}/api/profile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      spinner.fail("Failed to update profile");
      return;
    }

    const profile = (await res.json()) as ProfileResponse;
    spinner.stop();

    // Update local config if displayName changed
    if (body.displayName && body.displayName !== config.displayName) {
      config.displayName = body.displayName;
      await saveConfig(config);
    }

    console.log(chalk.green("\n  Profile updated!"));
    console.log(`  Name:       ${profile.displayName}`);
    console.log(`  Avatar:     ${profile.avatar || chalk.dim("(default)")}`);
    console.log(`  Visibility: ${profile.visibility === "public" ? chalk.green("public") : chalk.dim("private")}`);
    console.log();
  } catch (err) {
    spinner.fail(`Error: ${err instanceof Error ? err.message : err}`);
  }
}
