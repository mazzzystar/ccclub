import { AGENT_LABELS, AGENT_SOURCES, DEFAULT_SOURCES, PRICING_SNAPSHOT, createCostCalculator } from "@ccclub/shared";
import type { AgentSource, CostCalculator, UsageEntry } from "@ccclub/shared";
import type { ScanCacheFactory } from "../scan-cache.js";
import { ampCollector } from "./amp.js";
import { claudeCollector } from "./claude.js";
import { codexCollector } from "./codex.js";
import { cursorCollector } from "./cursor.js";
import { grokCollector } from "./grok.js";
import { openCodeCollector } from "./opencode.js";
import { piCollector } from "./pi.js";
import { byTimestamp } from "./shared.js";
import type { AgentSourceCollector, CollectorContext, SourceCollection, UsageTurn } from "./types.js";

export type { CollectorContext, UsageTurn, SourceCollection } from "./types.js";

// Deliberately no collector for non-coding sources (openclaw): the
// leaderboard measures coding agents, and the server excludes those sources
// from rankings regardless of what any client uploads. Cursor does have a
// collector, but it is opt-in (see OPT_IN_SOURCES) and therefore never
// reachable through DEFAULT_SOURCES.
const COLLECTORS: Partial<Record<AgentSource, AgentSourceCollector>> = {
  claude: claudeCollector,
  codex: codexCollector,
  opencode: openCodeCollector,
  amp: ampCollector,
  pi: piCollector,
  grok: grokCollector,
  cursor: cursorCollector,
};

export interface CollectionResult {
  entries: UsageEntry[];
  humanTurns: UsageTurn[];
  sources: SourceCollection[];
  warnings: string[];
}

/** A known source ccclub actually knows how to read. Opt-in sources included. */
export function isCollectableSource(value: string): value is AgentSource {
  return (AGENT_SOURCES as readonly string[]).includes(value) && COLLECTORS[value as AgentSource] != null;
}

export function parseSources(value: string | undefined): AgentSource[] {
  if (value == null || value.trim() === "") return [...DEFAULT_SOURCES];
  const sources = value
    .split(",")
    .map((source) => source.trim().toLowerCase())
    .filter(isCollectableSource);
  return sources.length > 0 ? Array.from(new Set(sources)) : [...DEFAULT_SOURCES];
}

/**
 * The sources this machine durably tracks: the always-on defaults plus every
 * opt-in source the user explicitly enabled. This is the one place that turns
 * stored config into a source list, so an opt-in source can only ever be
 * collected by a config that names it — a user who never ran
 * `ccclub sources enable` gets exactly DEFAULT_SOURCES, and the opt-in
 * collectors are never entered at all.
 */
export function getEffectiveSources(config?: { enabledSources?: string[] } | null): AgentSource[] {
  const enabled = (config?.enabledSources ?? [])
    .map((source) => String(source).trim().toLowerCase())
    .filter(isCollectableSource);
  return Array.from(new Set([...DEFAULT_SOURCES, ...enabled]));
}

/**
 * Which sources to collect for one run. CCCLUB_SOURCES stays a per-run filter
 * over collectable sources and never changes what the machine durably tracks.
 */
export function resolveCollectSources(config?: { enabledSources?: string[] } | null): AgentSource[] {
  return process.env.CCCLUB_SOURCES?.trim()
    ? parseSources(process.env.CCCLUB_SOURCES)
    : getEffectiveSources(config);
}

export function formatSourceList(sources: Iterable<AgentSource>): string {
  return Array.from(sources).map((source) => AGENT_LABELS[source]).join(", ");
}

export async function collectAllUsageEntries(options?: {
  sources?: AgentSource[];
  calculateCost?: CostCalculator;
  openScanCache?: ScanCacheFactory;
  lastSyncBySource?: Partial<Record<AgentSource, string>>;
}): Promise<CollectionResult> {
  const selectedSources = options?.sources ?? parseSources(process.env.CCCLUB_SOURCES);
  const context: CollectorContext = {
    // Commands pass the locally cached table; the bundled snapshot keeps
    // collection working without any setup (tests, first run).
    calculateCost: options?.calculateCost ?? createCostCalculator(PRICING_SNAPSHOT),
    openScanCache: options?.openScanCache,
    lastSyncBySource: options?.lastSyncBySource,
  };
  const results = await Promise.all(
    selectedSources.map(async (source): Promise<SourceCollection> => {
      const collector = COLLECTORS[source];
      if (collector == null) {
        return { source, entries: [], turns: [], files: 0, warnings: [] };
      }
      try {
        return await collector.collect(context);
      } catch (error) {
        // Last resort, and an expensive one: one throw here discards
        // everything the source had, not just the record that caused it — a
        // single dangling symlink under ~/.claude/projects once cost a whole
        // day of Claude usage this way. Collectors contain their own per-file
        // failures now (see readJsonlFile and the stat skips in each one), so
        // reaching this means something unmodelled broke, and the warning has
        // to say out loud how much was dropped rather than read like a note
        // about one file.
        const label = AGENT_LABELS[source];
        const message = error instanceof Error ? error.message : String(error);
        return {
          source,
          entries: [],
          turns: [],
          files: 0,
          warnings: [`${label}: collection failed, so NO ${label} usage was counted in this run (${message})`],
        };
      }
    }),
  );

  // Turns must stay globally sorted: aggregateToBlocks re-sorts entries per
  // source but sweeps turns with a monotonic cursor, so this is the only sort
  // that puts them in order.
  const entries = results.flatMap((result) => result.entries).sort(byTimestamp);
  const humanTurns = results.flatMap((result) => result.turns).sort(byTimestamp);
  const warnings = results.flatMap((result) => result.warnings);

  return { entries, humanTurns, sources: results, warnings };
}
