import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { joinCommand } from "./commands/join.js";
import { syncCommand } from "./commands/sync.js";
import { rankCommand } from "./commands/rank.js";
import { profileCommand } from "./commands/profile.js";
import { showDataCommand } from "./commands/show-data.js";
import { createGroupCommand } from "./commands/group.js";
import { hookCommand } from "./commands/hook.js";
const program = new Command();

program
  .name("ccclub")
  .description("CCClub - Compare Claude Code usage with friends")
  .version("0.2.17");

program
  .command("init")
  .description("Initialize CCClub (one-time setup)")
  .action(initCommand);

program
  .command("join")
  .description("Join a friend's group")
  .argument("<invite-code>", "6-character invite code")
  .action(joinCommand);

program
  .command("sync")
  .description("Sync local usage data to server")
  .option("-s, --silent", "No output (used by auto-sync hook)")
  .option("-f, --full", "Force full re-sync of all data")
  .action(syncCommand);

program
  .command("rank", { isDefault: true })
  .description("Show leaderboard rankings")
  .option("-p, --period <period>", "daily, weekly, monthly, all-time", "daily")
  .option("-g, --group <code>", "Group invite code")
  .option("--global", "Show global public ranking")
  .action(rankCommand);

program
  .command("profile")
  .description("View or update your profile")
  .option("-n, --name <name>", "Set display name")
  .option("--avatar <url>", "Set avatar URL (empty string to reset)")
  .option("--public", "Set profile visibility to public")
  .option("--private", "Set profile visibility to private")
  .action(profileCommand);

program
  .command("create")
  .description("Create a new group")
  .action(createGroupCommand);

program
  .command("show-data")
  .description("Show exactly what data CCClub uploads (privacy audit)")
  .action(showDataCommand);

program
  .command("hook")
  .description("Set up Claude Code hook for auto-sync on session end")
  .action(hookCommand);

program.parse();
