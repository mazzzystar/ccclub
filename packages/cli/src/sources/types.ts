import { getAdditionalReasoningTokens } from "@ccclub/shared";
import type { AgentSource, CostCalculator, UsageEntry } from "@ccclub/shared";
import type { ScanCacheFactory } from "../scan-cache.js";

/**
 * Dependencies handed to every collector. The cost calculator is injected so
 * cost logic lives in exactly one pricing table per run (local cache or
 * bundled snapshot), chosen by the command that starts collection.
 */
export interface CollectorContext {
  calculateCost: CostCalculator;
  /** When absent (tests, library use), collectors parse everything cold. */
  openScanCache?: ScanCacheFactory;
}

/**
 * Pricing-independent usage parsed from one agent log record. Persisting facts
 * instead of calculated cost lets a new pricing table reprice history without
 * re-reading the original (potentially multi-GB) logs.
 */
export type UsageFact = Omit<UsageEntry, "costUSD"> & {
  /** Provider-reported cost, when that source has historically treated it as authoritative. */
  reportedCostUSD?: number;
};

export function priceUsageFact(
  fact: UsageFact,
  context: CollectorContext,
  pricingTier: "standard" | "fast" = "standard",
): UsageEntry {
  const { reportedCostUSD, ...usage } = fact;
  const calculated = context.calculateCost(
    usage.model,
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheCreationTokens,
    usage.cacheReadTokens,
    getAdditionalReasoningTokens(usage.source, usage.reasoningTokens),
    usage.cacheCreation1hTokens || 0,
    pricingTier,
  );
  return {
    ...usage,
    costUSD: reportedCostUSD != null && reportedCostUSD > 0 ? reportedCostUSD : calculated,
  };
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
