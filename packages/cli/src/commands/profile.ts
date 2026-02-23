import chalk from "chalk";
import ora from "ora";
import type { ProfileResponse } from "@ccclub/shared";
import { PLAN_LABELS } from "@ccclub/shared";
import { requireConfig, saveConfig } from "../config.js";

export async function profileCommand(options: {
  name?: string;
  avatar?: string;
  public?: boolean;
  private?: boolean;
  plan?: string;
  url?: string;
}): Promise<void> {
  const config = await requireConfig();

  const hasUpdate = options.name !== undefined || options.avatar !== undefined || options.public || options.private || options.plan !== undefined || options.url !== undefined;

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
      console.log(`  Plan:       ${profile.plan ? PLAN_LABELS[profile.plan as keyof typeof PLAN_LABELS] || profile.plan : chalk.dim("(not set)")}`);
      console.log(`  URL:        ${profile.url || chalk.dim("(not set)")}`);
      console.log();
    } catch (err) {
      spinner.fail(`Error: ${err instanceof Error ? err.message : err}`);
    }
    return;
  }

  // Validate plan
  const validPlans = ["pro", "max100", "max200", "api"];
  if (options.plan !== undefined) {
    const p = options.plan.toLowerCase();
    if (p && p !== "none" && !validPlans.includes(p)) {
      console.log(chalk.red(`\n  Invalid plan: "${options.plan}"`));
      console.log(chalk.dim("  Valid options: ") + chalk.white("pro") + chalk.dim(" ($20), ") + chalk.white("max100") + chalk.dim(" ($100), ") + chalk.white("max200") + chalk.dim(" ($200), ") + chalk.white("api"));
      console.log(chalk.dim("  To clear: ") + chalk.white('ccclub profile --plan none'));
      return;
    }
  }

  // Build update payload
  const body: Record<string, string> = {};
  if (options.name !== undefined) body.displayName = options.name;
  if (options.avatar !== undefined) body.avatar = options.avatar;
  if (options.public) body.visibility = "public";
  if (options.private) body.visibility = "private";
  if (options.plan !== undefined) body.plan = options.plan === "none" ? "" : options.plan;
  if (options.url !== undefined) body.url = options.url;

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
    console.log(`  Plan:       ${profile.plan ? PLAN_LABELS[profile.plan as keyof typeof PLAN_LABELS] || profile.plan : chalk.dim("(not set)")}`);
    console.log(`  URL:        ${profile.url || chalk.dim("(not set)")}`);
    console.log();
  } catch (err) {
    spinner.fail(`Error: ${err instanceof Error ? err.message : err}`);
  }
}
