import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, saveConfig, generateDeviceToken, getApiUrl, getDefaultDisplayName } from "../config.js";
import { installHook } from "../hook.js";
import { doSync } from "./sync.js";
import { ensureGlobalInstall } from "../global-install.js";
import { maybeAutoEnableStatusline } from "../statusline-install.js";
import { formatFetchError } from "../fetch-error.js";
import type { JoinResponse } from "@ccclub/shared";

/**
 * Accept whatever the user pastes: a bare code (any case) or a full invite /
 * dashboard URL ("https://ccclub.dev/invite/YHAW6P", "ccclub.dev/g/YHAW6P").
 * Returns the normalized uppercase code, or null when nothing code-like is in
 * the input.
 */
export function parseInviteCode(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const fromUrl = /(?:invite|g)\/([A-Za-z0-9]{4,12})/.exec(trimmed)?.[1];
  const candidate = fromUrl ?? trimmed;
  return /^[A-Za-z0-9]{4,12}$/.test(candidate) ? candidate.toUpperCase() : null;
}

export async function joinCommand(rawCode: string): Promise<void> {
  const inviteCode = parseInviteCode(rawCode);
  if (inviteCode == null) {
    console.error(chalk.red(`Couldn't find an invite code in "${rawCode}".`));
    console.log(chalk.dim("  Use the 6-letter code or the full link, e.g.:  ccclub join YHAW6P"));
    return;
  }

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

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, displayName, inviteCode }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    spinner.fail(`Join failed: ${formatFetchError(err)}`);
    return;
  }

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
    await installHook();
  }

  spinner.succeed(`Joined "${data.groupName}"!`);

  // First sync if new user
  if (!config) {
    console.log("");
    await doSync(true);
    // Auto-install globally so `ccclub` works without npx
    const globalOk = await ensureGlobalInstall();
    // Claim the Claude Code statusline only when nothing else occupies it.
    // A miss here (global install failed) is no longer final — sync retries.
    const statusline = await maybeAutoEnableStatusline({ checkGlobal: async () => globalOk });
    if (statusline === "enabled") {
      console.log(chalk.dim('  ✓ Claude Code statusline enabled — model · 5h/7d limits · rank ("ccclub statusline off" to remove)'));
    }
  } else {
    // Repeat joiners from before the statusline (or whose first enable was
    // missed) get another chance here.
    const statusline = await maybeAutoEnableStatusline();
    if (statusline === "enabled") {
      console.log(chalk.dim('  ✓ Claude Code statusline enabled — model · 5h/7d limits · rank ("ccclub statusline off" to remove)'));
    } else if (statusline === "no-global") {
      console.log(chalk.dim('  Statusline needs a global install — run "npm install -g ccclub" and it will enable itself.'));
    }
  }

  console.log("");
  console.log(chalk.dim("  Run ") + chalk.white("ccclub") + chalk.dim(" to see the leaderboard. ") + chalk.white("ccclub -h") + chalk.dim(" for all commands."));
  console.log("");
}
