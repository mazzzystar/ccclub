// Raw JSONL entry from ~/.claude/projects/**/*.jsonl
export interface RawJSONLEntry {
  type: string;
  timestamp: string;
  sessionId: string;
  version?: string;
  requestId?: string;
  message?: {
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

// Parsed usage entry after validation
export interface UsageEntry {
  timestamp: string;
  sessionId: string;
  requestId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUSD: number;
}

// Aggregated 30-minute block for upload
export interface UsageBlock {
  blockStart: string;
  blockEnd: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
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
  joinedAt: string;
}

// KV: usage:{userId} → UsageData
export interface UsageData {
  blocks: UsageBlock[];
  lastSync: string;
}

// Ranking entry
export interface RankingEntry {
  rank: number;
  userId: string;
  displayName: string;
  avatar: string;
  plan?: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  monthlyCostUSD?: number;
  models: string[];
  entryCount: number;
  chatCount: number;
}

export type RankingPeriod = "daily" | "weekly" | "monthly" | "all-time";

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
}

export interface ProfileResponse {
  displayName: string;
  avatar: string;
  visibility: "public" | "private";
  plan?: string;
}

// API: GET /api/rank/:code
export interface RankResponse {
  group: { name: string; code: string; memberCount: number };
  period: RankingPeriod;
  start: string;
  end: string;
  rankings: RankingEntry[];
}
