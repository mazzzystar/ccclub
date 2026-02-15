import { Command, Option } from "commander";
import { initCommand } from "./commands/init.js";
import { joinCommand } from "./commands/join.js";
import { syncCommand } from "./commands/sync.js";
import { rankCommand } from "./commands/rank.js";
import { profileCommand } from "./commands/profile.js";
import { showDataCommand } from "./commands/show-data.js";
import { createGroupCommand } from "./commands/group.js";
import { hookCommand } from "./commands/hook.js";
import { startUpdateCheck } from "./update-check.js";

const VERSION = "0.2.52";
startUpdateCheck(VERSION);

const program = new Command();

program
  .name("ccclub")
  .description("Compare Claude Code usage with friends")
  .version(VERSION, "-v, -V, --version");

// Default command — just running `ccclub` shows the leaderboard
program
  .command("rank", { isDefault: true, hidden: true })
  .description("Show leaderboard")
  .option("-d, --days <days>", "Time window: 7 | 30 | all")
  .addOption(new Option("-p, --period [period]").hideHelp())
  .option("-g, --group <code>", "Group invite code")
  .option("--global", "Show global public ranking")
  .option("--cache", "Include cache tokens in count")
  .action(rankCommand);

// --- Setup (one-time) ---

program
  .command("init")
  .description("Create a group and start tracking (first-time setup)")
  .action(initCommand);

program
  .command("join")
  .description("Join a group with a 6-letter invite code")
  .argument("<invite-code>", "6-character invite code")
  .action(joinCommand);

// --- Regular use ---

program
  .command("sync")
  .description("Upload usage data (runs automatically after each chat)")
  .addOption(new Option("-s, --silent").hideHelp())
  .option("-f, --force", "Force full re-sync of all data")
  .addOption(new Option("--full", "Same as --force").hideHelp())
  .action((options: { silent?: boolean; full?: boolean; force?: boolean }) =>
    syncCommand({ ...options, full: options.full || options.force }),
  );

program
  .command("profile")
  .description("View or update name, avatar, plan, visibility")
  .option("-n, --name <name>", "Set display name")
  .option("--avatar <url>", "Set avatar URL (empty to reset)")
  .option("--public", "Make profile visible in global ranking")
  .option("--private", "Hide from global ranking")
  .option("--plan <plan>", "pro ($20) | max100 ($100) | max200 ($200) | api | none")
  .action(profileCommand);

program
  .command("create")
  .description("Create an additional group")
  .action(createGroupCommand);

program
  .command("show-data")
  .description("Preview exactly what gets uploaded (privacy check)")
  .action(showDataCommand);

// Internal — auto-installed, users don't need to run this
program
  .command("hook", { hidden: true })
  .description("Set up auto-sync hook")
  .action(hookCommand);

program.addHelpText("after", `
Examples:
  $ ccclub                 Show today's leaderboard (default)
  $ ccclub -d 7            Time window: 7 / 30 / all
  $ ccclub --global        Global public leaderboard
  $ ccclub --cache         Include cache tokens in total
  $ ccclub sync --force    Force full re-sync of all data
`);

program.parse();
