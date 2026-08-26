import chalk from "chalk";
import { AGENT_LABELS, AGENT_SOURCES, DEFAULT_SOURCES, OPT_IN_SOURCES } from "@ccclub/shared";
import type { AgentSource } from "@ccclub/shared";
import { loadConfig, requireConfig, saveConfig } from "../config.js";
import type { CliConfig } from "../config.js";
import { getEffectiveSources, isCollectableSource } from "../sources/index.js";
import { theme } from "../theme.js";

export type SourceChange =
  | { ok: true; source: AgentSource; enabledSources: string[]; changed: boolean }
  | { ok: false; error: string };

/** Opt-in sources ccclub can actually read — the only ones `enable` accepts. */
export function enableableSources(): AgentSource[] {
  return OPT_IN_SOURCES.filter(isCollectableSource);
}

function normalize(rawName: string): string {
  return rawName.trim().toLowerCase();
}

function unknownSourceError(name: string): string {
  const known = AGENT_SOURCES.join(", ");
  return `Unknown source "${name}". Known sources: ${known}`;
}

/**
 * Add one opt-in source to the durable enabled list. Enabling is restricted to
 * OPT_IN_SOURCES that have a collector: default sources need nothing, and a
 * source ccclub deliberately refuses to read (OpenClaw) must fail loudly
 * rather than write a setting that quietly does nothing.
 * @internal exported for tests.
 */
export function withSourceEnabled(config: Pick<CliConfig, "enabledSources">, rawName: string): SourceChange {
  const name = normalize(rawName);
  if (!(AGENT_SOURCES as readonly string[]).includes(name)) {
    return { ok: false, error: unknownSourceError(rawName.trim()) };
  }
  const source = name as AgentSource;
  if (!OPT_IN_SOURCES.includes(source)) {
    return {
      ok: false,
      error: `${AGENT_LABELS[source]} is collected by default — there is nothing to enable.`,
    };
  }
  if (!isCollectableSource(source)) {
    return {
      ok: false,
      error: `${AGENT_LABELS[source]} is a personal assistant, not a coding agent. ccclub has no collector for it, and the leaderboard never counts it.`,
    };
  }

  const current = config.enabledSources ?? [];
  if (current.map(normalize).includes(source)) {
    return { ok: true, source, enabledSources: current, changed: false };
  }
  return { ok: true, source, enabledSources: [...current, source], changed: true };
}

/** Drop one opt-in source from the durable enabled list. @internal exported for tests. */
export function withSourceDisabled(config: Pick<CliConfig, "enabledSources">, rawName: string): SourceChange {
  const name = normalize(rawName);
  if (!(AGENT_SOURCES as readonly string[]).includes(name)) {
    return { ok: false, error: unknownSourceError(rawName.trim()) };
  }
  const source = name as AgentSource;
  if (!OPT_IN_SOURCES.includes(source)) {
    return {
      ok: false,
      error: `${AGENT_LABELS[source]} is a default source and cannot be turned off. To skip it for one run: CCCLUB_SOURCES=<sources> ccclub sync`,
    };
  }

  const current = config.enabledSources ?? [];
  const next = current.filter((entry) => normalize(entry) !== source);
  return { ok: true, source, enabledSources: next, changed: next.length !== current.length };
}

/**
 * What `enable` tells the user before it writes anything. An opt-in source
 * exists because turning it on does something the user would want to be asked
 * about first, so the consent text lives next to the flag that grants it.
 */
const ENABLE_NOTICE: Partial<Record<AgentSource, string[]>> = {
  cursor: [
    "Cursor writes no local token or cost logs, so — unlike every other source —",
    "ccclub cannot read it from disk. Enabling Cursor means:",
    "",
    "  · ccclub reads the Cursor access token that Cursor itself stored in your",
    "    macOS Keychain (or CURSOR_ACCESS_TOKEN, if you set it). The refresh",
    "    token is never read, and macOS may ask you to authorize the read once.",
    "  · ccclub calls Cursor's own dashboard API (https://api2.cursor.sh) over",
    "    HTTPS to fetch your usage events — the same numbers the Cursor app shows.",
    "  · Your Cursor token is never uploaded to ccclub. It only authenticates you",
    "    to Cursor.",
    "  · What syncs to ccclub is what always syncs: aggregated 30-minute blocks",
    "    of tokens, cost, and model names. No prompts, no code, no file paths.",
  ],
};

export async function sourcesEnableCommand(name: string): Promise<void> {
  const config = await requireConfig();
  const change = withSourceEnabled(config, name);
  if (!change.ok) {
    console.log(chalk.red(`\n  ${change.error}`));
    console.log(chalk.dim(`  Enable one of: ${enableableSources().join(", ")}\n`));
    return;
  }

  const label = AGENT_LABELS[change.source];
  if (!change.changed) {
    console.log(theme.success(`\n  ${label} is already enabled.`));
    console.log(chalk.dim(`  Turn it off with: ccclub sources disable ${change.source}\n`));
    return;
  }

  // Print the consent notice BEFORE persisting, so the terms are on screen
  // even if the write fails.
  const notice = ENABLE_NOTICE[change.source];
  if (notice) {
    console.log(chalk.bold(`\n  Enabling ${label}\n`));
    for (const line of notice) console.log(line ? chalk.dim(`  ${line}`) : "");
    console.log();
  }

  await saveConfig({ ...config, enabledSources: change.enabledSources });
  console.log(theme.success(`  ✓ ${label} enabled`) + chalk.dim(" — it syncs from the next sync onward."));
  console.log(chalk.dim(`  Preview what gets uploaded: ccclub show-data`));
  console.log(chalk.dim(`  Turn it off any time:       ccclub sources disable ${change.source}\n`));
}

export async function sourcesDisableCommand(name: string): Promise<void> {
  const config = await requireConfig();
  const change = withSourceDisabled(config, name);
  if (!change.ok) {
    console.log(chalk.red(`\n  ${change.error}\n`));
    return;
  }

  const label = AGENT_LABELS[change.source];
  if (!change.changed) {
    console.log(chalk.dim(`\n  ${label} is not enabled — nothing to do.\n`));
    return;
  }

  await saveConfig({ ...config, enabledSources: change.enabledSources });
  console.log(theme.success(`\n  ✓ ${label} disabled`) + chalk.dim(" — no further data is collected from it."));
  console.log(chalk.dim(`  Blocks already synced stay on the leaderboard.\n`));
}

export async function sourcesListCommand(): Promise<void> {
  const config = await loadConfig();
  const effective = new Set(getEffectiveSources(config));
  const width = Math.max(...AGENT_SOURCES.map((source) => AGENT_LABELS[source].length));

  console.log(chalk.bold("\n  Sources\n"));
  for (const source of AGENT_SOURCES) {
    const label = AGENT_LABELS[source].padEnd(width);
    const optIn = OPT_IN_SOURCES.includes(source);
    const on = effective.has(source);
    const state = on ? theme.success("on ") : chalk.dim("off");
    let note: string;
    if (!optIn) {
      note = chalk.dim("default");
    } else if (!isCollectableSource(source)) {
      note = chalk.dim("not a coding agent — never collected");
    } else if (on) {
      note = chalk.dim(`opt-in · enabled (ccclub sources disable ${source})`);
    } else {
      note = chalk.dim(`opt-in · ccclub sources enable ${source}`);
    }
    console.log(`    ${chalk.white(label)}  ${state}  ${note}`);
  }

  console.log();
  console.log(chalk.dim(`  Default sources need no setup. ${DEFAULT_SOURCES.length} of ${AGENT_SOURCES.length} are on by default.`));
  if (process.env.CCCLUB_SOURCES?.trim()) {
    console.log(chalk.dim(`  CCCLUB_SOURCES is set — it filters this shell's runs only, not the list above.`));
  }
  console.log();
}
