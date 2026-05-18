import { AGENT_LABELS, AGENT_SOURCES } from "@ccclub/shared";
import type { AgentSource, UsageEntry } from "@ccclub/shared";
import { ampCollector } from "./amp.js";
import { claudeCollector } from "./claude.js";
import { codexCollector } from "./codex.js";
import { openCodeCollector } from "./opencode.js";
import { piCollector } from "./pi.js";
import type { AgentSourceCollector, SourceCollection, UsageTurn } from "./types.js";

export type { UsageTurn, SourceCollection } from "./types.js";

const COLLECTORS: Record<AgentSource, AgentSourceCollector> = {
  claude: claudeCollector,
  codex: codexCollector,
  opencode: openCodeCollector,
  amp: ampCollector,
  pi: piCollector,
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
  if (value == null || value.trim() === "") return [...AGENT_SOURCES];
  const sources = value
    .split(",")
    .map((source) => source.trim().toLowerCase())
    .filter((source): source is AgentSource => isAgentSource(source));
  return sources.length > 0 ? Array.from(new Set(sources)) : [...AGENT_SOURCES];
}

export function formatSourceList(sources: Iterable<AgentSource>): string {
  return Array.from(sources).map((source) => AGENT_LABELS[source]).join(", ");
}

export async function collectAllUsageEntries(options?: { sources?: AgentSource[] }): Promise<CollectionResult> {
  const selectedSources = options?.sources ?? parseSources(process.env.CCCLUB_SOURCES);
  const results = await Promise.all(
    selectedSources.map(async (source): Promise<SourceCollection> => {
      const collector = COLLECTORS[source];
      try {
        return await collector.collect();
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
