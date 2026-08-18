import { AGENT_LABELS, AGENT_SOURCES, DEFAULT_SOURCES, PRICING_SNAPSHOT, createCostCalculator } from "@ccclub/shared";
import type { AgentSource, CostCalculator, UsageEntry } from "@ccclub/shared";
import type { ScanCacheFactory } from "../scan-cache.js";
import { ampCollector } from "./amp.js";
import { claudeCollector } from "./claude.js";
import { codexCollector } from "./codex.js";
import { grokCollector } from "./grok.js";
import { openCodeCollector } from "./opencode.js";
import { piCollector } from "./pi.js";
import type { AgentSourceCollector, CollectorContext, SourceCollection, UsageTurn } from "./types.js";

export type { CollectorContext, UsageTurn, SourceCollection } from "./types.js";

// Deliberately no collector for opt-in/non-coding sources (openclaw): the
// leaderboard measures coding agents, and the server excludes those sources
// from rankings regardless of what any client uploads.
const COLLECTORS: Partial<Record<AgentSource, AgentSourceCollector>> = {
  claude: claudeCollector,
  codex: codexCollector,
  opencode: openCodeCollector,
  amp: ampCollector,
  pi: piCollector,
  grok: grokCollector,
};

export interface CollectionResult {
  entries: UsageEntry[];
  humanTurns: UsageTurn[];
  sources: SourceCollection[];
  warnings: string[];
}

function isCollectableSource(value: string): value is AgentSource {
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

export function formatSourceList(sources: Iterable<AgentSource>): string {
  return Array.from(sources).map((source) => AGENT_LABELS[source]).join(", ");
}

export async function collectAllUsageEntries(options?: {
  sources?: AgentSource[];
  calculateCost?: CostCalculator;
  openScanCache?: ScanCacheFactory;
}): Promise<CollectionResult> {
  const selectedSources = options?.sources ?? parseSources(process.env.CCCLUB_SOURCES);
  const context: CollectorContext = {
    // Commands pass the locally cached table; the bundled snapshot keeps
    // collection working without any setup (tests, first run).
    calculateCost: options?.calculateCost ?? createCostCalculator(PRICING_SNAPSHOT),
    openScanCache: options?.openScanCache,
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
        return {
          source,
          entries: [],
          turns: [],
          files: 0,
          warnings: [`${AGENT_LABELS[source]}: ${error instanceof Error ? error.message : String(error)}`],
        };
      }
    }),
  );

  const entries = results.flatMap((result) => result.entries).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const humanTurns = results.flatMap((result) => result.turns).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const warnings = results.flatMap((result) => result.warnings);

  return { entries, humanTurns, sources: results, warnings };
}
