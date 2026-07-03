import { Command, Option } from "commander";
import { initCommand } from "./commands/init.js";
import { joinCommand } from "./commands/join.js";
import { syncCommand } from "./commands/sync.js";
import { rankCommand } from "./commands/rank.js";
import { profileCommand } from "./commands/profile.js";
import { showDataCommand } from "./commands/show-data.js";
import { createGroupCommand } from "./commands/group.js";
import { leaveCommand } from "./commands/leave.js";
import { hookCommand } from "./commands/hook.js";
import { linkCommand } from "./commands/link.js";
import { deviceLinkCommand } from "./commands/device.js";
import { mergeCodeCommand, mergeCommand } from "./commands/merge.js";
import { startUpdateCheck } from "./update-check.js";

declare const __VERSION__: string;
const VERSION = __VERSION__;
startUpdateCheck(VERSION);

const program = new Command();

// Keep the shorter -v alias while letting Commander own the standard -V/--version flags.
if (process.argv.slice(2).includes("-v")) {
  console.log(VERSION);
  process.exit(0);
}

program
  .name("ccclub")
  .description("Claude Code, Codex, OpenCode, Amp, and pi-agent usage leaderboard among friends")
  .version(VERSION);

// Default command — just running `ccclub` shows the leaderboard
program
  .command("rank", { isDefault: true, hidden: true })
  .description("Show leaderboard")
  .option("-d, --days [days]", "Time window: 1 | 7 | 30 | all (default: today)")
  .addOption(new Option("-p, --period [period]").hideHelp())
  .option("-g, --group <code>", "Group invite code")
  .option("--global", "Show global public ranking")
  .addOption(new Option("--cache", "Include cache tokens in count (default)").hideHelp())
  .option("--no-cache", "Exclude cache tokens from token counts")
  .option("--all", "Show all members including those with no activity")
  .action(rankCommand);

// --- Setup (one-time) ---

program
  .command("init")
  .description("Create a group and get started (first-time setup)")
  .action(initCommand);

program
  .command("join")
  .description("Join a group with a 6-letter invite code")
  .argument("[invite-code]", "6-character invite code")
  .action((code: string | undefined) => {
    if (!code) {
      console.log(`\n  Usage:  ccclub join <code>\n\n  Example:\n    ccclub join YHAW6P\n\n  Ask a friend for their 6-letter invite code, or create your own group:\n    ccclub init\n`);
      return;
    }
    return joinCommand(code);
  });

program
  .command("link")
  .description("Link this terminal to an existing ccclub user")
  .argument("[code]", "device link code")
  .action((code: string | undefined) => linkCommand(code));

program
  .command("merge-code")
  .description("Create a one-time code to merge another account into this one")
  .action(mergeCodeCommand);

program
  .command("merge")
  .description("Merge this account into the account that created the code")
  .argument("[code]", "account merge code")
  .action((code: string | undefined) => mergeCommand(code));

const device = program
  .command("device")
  .description("Manage linked terminals");

device
  .command("link")
  .description("Create a one-time code to link another terminal")
  .action(deviceLinkCommand);

// --- Regular use ---

program
  .command("sync")
  .description("Upload local coding agent usage now (auto-sync also runs after setup)")
  .addOption(new Option("-s, --silent").hideHelp())
  .option("-f, --force", "Re-scan and upload all local usage logs")
  .addOption(new Option("--full", "Same as --force").hideHelp())
  .action((options: { silent?: boolean; full?: boolean; force?: boolean }) =>
    syncCommand({ ...options, full: options.full || options.force }),
  );

program
  .command("profile")
  .description("View or update your profile")
  .option("-n, --name <name>", "Set display name")
  .option("--avatar <url>", "Set avatar URL (empty to reset)")
  .option("--public", "Make profile visible in global ranking")
  .option("--private", "Hide from global ranking")
  .option("--plan <plan>", "pro ($20) | max100 ($100) | max200 ($200) | api | none")
  .option("--url <url>", "Link your name to a URL (GitHub, website, etc.)")
  .action(profileCommand);

program
  .command("create")
  .description("Create an additional group")
  .action(createGroupCommand);

program
  .command("leave")
  .description("Leave a group")
  .argument("[code]", "Group invite code")
  .action((code: string | undefined) => leaveCommand(code));

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
Setup:
  ccclub init             Create your group and enable auto-sync
  ccclub join <code>      Join a friend's group
  ccclub device link      Create a one-time code to link another terminal
  ccclub merge-code       Create a code to merge another account into this one

Supported agents:
  Claude Code, Codex, OpenCode, Amp, pi-agent

Leaderboard options:
  -d <period>              Time window: 1 | 7 | 30 | all (default: today)
  -g <code>                Show a specific group
  --global                 Global public leaderboard
  --no-cache               Exclude cache tokens from token totals
  --all                    Show all members including inactive ones

Examples:
  $ npx ccclub init        First-time setup
  $ ccclub device link     Link another terminal to the same user
  $ ccclub link ABCD2345   Run on the other terminal
  $ ccclub merge-code      Keep this account; generate an account merge code
  $ ccclub merge WXYZ6789  Run on the account to merge into this one
  $ ccclub                 Show today's leaderboard (default)
  $ ccclub -d 1|7|30|all   Time window (default: today)
  $ ccclub --global        Global public leaderboard
  $ ccclub show-data       Preview exactly what gets uploaded
`);

program.parse();
