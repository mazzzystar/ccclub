import type { AgentSource, CostCalculator, UsageEntry } from "@ccclub/shared";
import type { ScanCacheFactory } from "../scan-cache.js";

/**
 * Dependencies handed to every collector. The cost calculator is injected so
 * cost logic lives in exactly one pricing table per run (local cache or
 * bundled snapshot), chosen by the command that starts collection.
 */
export interface CollectorContext {
  calculateCost: CostCalculator;
  /** Version of the pricing table behind calculateCost; part of cache keys. */
  pricingVersion: string;
  /** When absent (tests, library use), collectors parse everything cold. */
  openScanCache?: ScanCacheFactory;
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
