import type { AgentSource, CostCalculator, UsageEntry } from "@ccclub/shared";

/**
 * Dependencies handed to every collector. The cost calculator is injected so
 * cost logic lives in exactly one pricing table per run (local cache or
 * bundled snapshot), chosen by the command that starts collection.
 */
export interface CollectorContext {
  calculateCost: CostCalculator;
}

export interface UsageTurn {
  source: AgentSource;
  timestamp: string;
  key: string;
}

export interface SourceCollection {
  source: AgentSource;
  entries: UsageEntry[];
  turns: UsageTurn[];
  files: number;
  warnings: string[];
}

export interface AgentSourceCollector {
  source: AgentSource;
  label: string;
  collect(context: CollectorContext): Promise<SourceCollection>;
}
