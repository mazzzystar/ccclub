import { AGENT_LABELS, AGENT_SOURCES, DEFAULT_SOURCES, PRICING_SNAPSHOT, createCostCalculator } from "@ccclub/shared";
import type { AgentSource, CostCalculator, UsageEntry } from "@ccclub/shared";
import type { ScanCacheFactory } from "../scan-cache.js";
import { ampCollector } from "./amp.js";
import { claudeCollector } from "./claude.js";
import { codexCollector } from "./codex.js";
import { openClawCollector } from "./openclaw.js";
import { openCodeCollector } from "./opencode.js";
import { piCollector } from "./pi.js";
import type { AgentSourceCollector, CollectorContext, SourceCollection, UsageTurn } from "./types.js";

export type { CollectorContext, UsageTurn, SourceCollection } from "./types.js";

const COLLECTORS: Record<AgentSource, AgentSourceCollector> = {
  claude: claudeCollector,
  codex: codexCollector,
  opencode: openCodeCollector,
  amp: ampCollector,
  pi: piCollector,
  openclaw: openClawCollector,
};

export interface CollectionResult {
  entries: UsageEntry[];
  humanTurns: UsageTurn[];
  sources: SourceCollection[];
  warnings: string[];
}

function isAgentSource(value: string): value is AgentSource {
  return (AGENT_SOURCES as readonly string[]).includes(value);
}

export function parseSources(value: string | undefined): AgentSource[] {
  if (value == null || value.trim() === "") return [...DEFAULT_SOURCES];
  const sources = value
    .split(",")
    .map((source) => source.trim().toLowerCase())
    .filter((source): source is AgentSource => isAgentSource(source));
  return sources.length > 0 ? Array.from(new Set(sources)) : [...DEFAULT_SOURCES];
}

/**
 * Sources this install durably tracks: the coding-agent defaults plus any
 * opt-in sources from config. Unlike CCCLUB_SOURCES (a per-run filter),
 * this is what gets reported to the server as `trackedSources`.
 */
export function resolveTrackedSources(extraSources: string[] | undefined): AgentSource[] {
  const tracked = [...DEFAULT_SOURCES];
  for (const source of extraSources ?? []) {
    if (isAgentSource(source) && !tracked.includes(source)) tracked.push(source);
  }
  return tracked;
}

export function formatSourceList(sources: Iterable<AgentSource>): string {
  return Array.from(sources).map((source) => AGENT_LABELS[source]).join(", ");
}

export async function collectAllUsageEntries(options?: {
  sources?: AgentSource[];
  calculateCost?: CostCalculator;
  pricingVersion?: string;
  openScanCache?: ScanCacheFactory;
}): Promise<CollectionResult> {
  const selectedSources = options?.sources ?? parseSources(process.env.CCCLUB_SOURCES);
  const context: CollectorContext = {
    // Commands pass the locally cached table; the bundled snapshot keeps
    // collection working without any setup (tests, first run).
    calculateCost: options?.calculateCost ?? createCostCalculator(PRICING_SNAPSHOT),
    pricingVersion: options?.pricingVersion ?? PRICING_SNAPSHOT.version,
    openScanCache: options?.openScanCache,
  };
  const results = await Promise.all(
    selectedSources.map(async (source): Promise<SourceCollection> => {
      const collector = COLLECTORS[source];
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
