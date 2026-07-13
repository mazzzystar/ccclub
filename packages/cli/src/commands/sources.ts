import chalk from "chalk";
import { AGENT_LABELS, DEFAULT_SOURCES, OPT_IN_SOURCES } from "@ccclub/shared";
import type { AgentSource } from "@ccclub/shared";
import { theme } from "../theme.js";
import { loadConfig, saveConfig } from "../config.js";
import { doSync } from "./sync.js";

function isOptInSource(value: string): value is AgentSource {
  return (OPT_IN_SOURCES as readonly string[]).includes(value);
}

export async function sourcesCommand(action?: string, source?: string): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    console.error('Not initialized. Run "ccclub init" or "ccclub join <code>" first.');
    process.exitCode = 1;
    return;
  }
  const enabled = new Set(config.extraSources ?? []);

  if (action === undefined) {
    console.log(chalk.bold("\n  Tracked sources:\n"));
    for (const s of DEFAULT_SOURCES) {
      console.log(`    ${theme.success("●")} ${AGENT_LABELS[s]} ${chalk.dim("(default)")}`);
    }
    for (const s of OPT_IN_SOURCES) {
      const on = enabled.has(s);
      console.log(`    ${on ? theme.success("●") : chalk.dim("○")} ${AGENT_LABELS[s]} ${chalk.dim(on ? "(opt-in, enabled)" : "(opt-in, off)")}`);
    }
    console.log(chalk.dim(`\n  Toggle opt-in sources:  ccclub sources enable|disable ${OPT_IN_SOURCES.join("|")}\n`));
    return;
  }

  if ((action !== "enable" && action !== "disable") || source === undefined || !isOptInSource(source)) {
    console.log(`\n  Usage:  ccclub sources [enable|disable] <${OPT_IN_SOURCES.join("|")}>\n`);
    if (source !== undefined && !isOptInSource(source)) {
      console.log(chalk.dim(`  Only opt-in sources can be toggled. Coding agents (${DEFAULT_SOURCES.map((s) => AGENT_LABELS[s]).join(", ")}) are always tracked.\n`));
    }
    return;
  }

  if (action === "enable") {
    if (!enabled.has(source)) {
      enabled.add(source);
      await saveConfig({ ...config, extraSources: Array.from(enabled) });
    }
    console.log(theme.success(`\n  ✓ ${AGENT_LABELS[source]} enabled`) + chalk.dim(" — uploading its history now...\n"));
    // Full sync so history older than the last incremental sync uploads too.
    await doSync(true);
    return;
  }

  if (enabled.has(source)) {
    enabled.delete(source);
    await saveConfig({ ...config, extraSources: Array.from(enabled) });
  }
  console.log(theme.success(`\n  ✓ ${AGENT_LABELS[source]} disabled`) + chalk.dim(" — removing it from the leaderboard...\n"));
  // Force a full sync: it always reaches the server (an incremental sync
  // with no new blocks returns early), and trackedSources without this
  // source makes the server prune its stored blocks immediately.
  await doSync(true);
}
