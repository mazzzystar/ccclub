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
  /**
   * Last block start successfully synced per source, as an ISO timestamp.
   * Only sources that fetch from a remote API need it — a log scanner reads
   * the whole file anyway, and the scan cache already makes that cheap.
   * Deliberately absent on a full/forced sync so those sources refetch their
   * entire window; a source with no entry here has never synced.
   */
  lastSyncBySource?: Partial<Record<AgentSource, string>>;
}

/**
 * Pricing-independent usage parsed from one agent log record. Persisting facts
 * instead of calculated cost lets a new pricing table reprice history without
 * re-reading the original (potentially multi-GB) logs.
 */
export type UsageFact = Omit<UsageEntry, "costUSD"> & {
  /**
   * Provider-reported cost, when that source has historically treated it as
   * authoritative. Set it only when the number is meant to win: an explicit 0
   * is a real answer ("this request cost nothing"), not a missing value, so
   * collectors that cannot distinguish the two must leave this undefined.
   */
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
    // Presence, not truthiness: a source that reports $0 (Cursor's included
    // requests) means it, and the pricing table would invent a cost instead —
    // its fallback rules never return 0.
    costUSD: reportedCostUSD !== undefined && reportedCostUSD >= 0 ? reportedCostUSD : calculated,
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
