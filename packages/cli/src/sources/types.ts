import type { AgentSource, UsageEntry } from "@ccclub/shared";

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
  collect(): Promise<SourceCollection>;
}
