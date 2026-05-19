export const AGENT_SOURCES = ["claude", "codex", "opencode", "amp", "pi"] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

export const AGENT_LABELS: Record<AgentSource, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  amp: "Amp",
  pi: "pi-agent",
};

// Raw JSONL entry from Claude Code's projects directory
export interface RawClaudeJSONLEntry {
  type: string;
  timestamp: string;
  sessionId: string;
  version?: string;
  requestId?: string;
  message?: {
    id?: string;
    model?: string;
    content?: unknown;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  costUSD?: number;
}

export type RawJSONLEntry = RawClaudeJSONLEntry;

// Parsed usage entry after validation
export interface UsageEntry {
  source: AgentSource;
  timestamp: string;
  sessionId: string;
  requestId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens?: number;
  totalTokens: number;
  costUSD: number;
}

// Aggregated 30-minute block for upload
export interface UsageBlock {
  source?: AgentSource; // Missing on pre-multi-agent uploads; treat as "claude"
  blockStart: string;
  blockEnd: string;
  lastActivityAt?: string; // Last real usage event in this block; absent in older uploads.
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens?: number;
  totalTokens: number;
  costUSD: number;
  models: string[];
  entryCount: number;
  chatCount?: number;
}

// KV: token:{deviceToken} → UserRecord
export interface UserRecord {
  userId: string;
  displayName: string;
  avatar: string;                    // URL or "" (empty = default)
  visibility: "public" | "private";  // default "private"
  plan?: string;                     // "pro" | "max100" | "max200" | "api"
  url?: string;                      // clickable link (GitHub, website, etc.)
  createdAt: string;
}

// KV: group:{inviteCode} → GroupRecord
export interface GroupRecord {
  name: string;
  code: string;
  createdBy: string;
  createdAt: string;
  members: GroupMember[];
}

export interface GroupMember {
  userId: string;
  displayName: string;
  avatar: string;
  plan?: string;
  url?: string;
  joinedAt: string;
}

// Subscription utilization snapshot (from Claude's OAuth API)
export interface UsageSnapshot {
  fiveHour: number;   // % of 5-hour quota used (0–100)
  sevenDay: number;   // % of 7-day quota used (0–100)
  snapshotAt: string; // ISO timestamp
}

// KV: usage:{userId} → UsageData
export interface UsageData {
  blocks: UsageBlock[];
  lastSync: string;
  usageSnapshot?: UsageSnapshot;
}

// Ranking entry
export interface RankingEntry {
  rank: number;
  userId: string;
  displayName: string;
  avatar: string;
  plan?: string;
  url?: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  costUSD: number;
  monthlyCostUSD?: number;
  models: string[];
  agents?: AgentSource[];
  agentBreakdown?: Array<{
    source: AgentSource;
    costUSD: number;
    totalTokens: number;
    nonCacheTokens: number;
    chatCount: number;
    entryCount: number;
    percent: number;
  }>;
  entryCount: number;
  chatCount: number;
  usageSnapshot?: UsageSnapshot;
  lastSync?: string;
  lastActiveAt?: string;
  lastActiveSource?: AgentSource;
}

export type RankingPeriod = "daily" | "yesterday" | "weekly" | "monthly" | "all-time";

// API: POST /api/init
export interface InitRequest {
  token: string;
  displayName: string;
}
export interface InitResponse {
  userId: string;
  groupCode: string;
  groupName: string;
}

// API: POST /api/join
export interface JoinRequest {
  token: string;
  displayName: string;
  inviteCode: string;
}
export interface JoinResponse {
  userId: string;
  groupCode: string;
  groupName: string;
}

// API: POST /api/sync
export interface SyncRequest {
  blocks: UsageBlock[];
  usageSnapshot?: UsageSnapshot;
}
export interface SyncResponse {
  synced: number;
}

// API: POST /api/profile
export interface ProfileUpdateRequest {
  displayName?: string;
  avatar?: string;
  visibility?: "public" | "private";
  plan?: string;
  url?: string;
}

export interface ProfileResponse {
  displayName: string;
  avatar: string;
  visibility: "public" | "private";
  plan?: string;
  url?: string;
}

// API: POST /api/leave
export interface LeaveRequest {
  inviteCode: string;
}
export interface LeaveResponse {
  ok: boolean;
  groupName: string;
}

// API: GET /api/rank/:code
export interface RankResponse {
  group: { name: string; code: string; memberCount: number };
  period: RankingPeriod;
  start: string;
  end: string;
  rankings: RankingEntry[];
}
