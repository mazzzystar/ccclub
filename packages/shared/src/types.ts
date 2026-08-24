export const AGENT_SOURCES = ["claude", "codex", "opencode", "amp", "pi", "grok", "openclaw"] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

// OpenClaw is a personal assistant, not a coding agent — counting it by
// default would dilute what the coding leaderboard measures. Opt-in sources
// are excluded unless the user runs `ccclub sources enable <source>`.
export const OPT_IN_SOURCES: readonly AgentSource[] = ["openclaw"];
export const DEFAULT_SOURCES: readonly AgentSource[] =
  AGENT_SOURCES.filter((source) => !OPT_IN_SOURCES.includes(source));

/**
 * Non-coding sources are excluded from every ranking computation server-side,
 * regardless of what clients upload — the leaderboard measures coding, and a
 * padded-looking source must not be usable to inflate rank.
 */
export function isRankedSource(source: AgentSource | undefined): boolean {
  return !OPT_IN_SOURCES.includes(source ?? "claude");
}

export const AGENT_LABELS: Record<AgentSource, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  amp: "Amp",
  pi: "Pi",
  grok: "Grok",
  openclaw: "OpenClaw",
};

// Raw JSONL entry from Claude Code's projects directory
export interface RawClaudeJSONLEntry {
  type: string;
  timestamp: string;
  sessionId: string;
  version?: string;
  requestId?: string;
  isSidechain?: boolean;
  is_sidechain?: boolean;
  message?: {
    id?: string;
    model?: string;
    content?: unknown;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation?: {
        ephemeral_5m_input_tokens?: number;
        ephemeral_1h_input_tokens?: number;
      };
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
  /** Subset of cacheCreationTokens written with a 1-hour TTL. */
  cacheCreation1hTokens?: number;
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
  /** Subset of cacheCreationTokens written with a 1-hour TTL. */
  cacheCreation1hTokens?: number;
  cacheReadTokens: number;
  reasoningTokens?: number;
  totalTokens: number;
  costUSD: number;
  models: string[];
  entryCount: number;
  chatCount?: number;
}

/**
 * Reasoning is a separate token bucket for most sources. Codex and Grok are
 * exceptions: their output counts already include reasoning, so
 * adding the reasoning breakdown again would double-count both cost and
 * non-cache token totals.
 */
export function getAdditionalReasoningTokens(
  source: AgentSource | undefined,
  reasoningTokens: number | undefined,
): number {
  return source === "codex" || source === "grok" ? 0 : reasoningTokens || 0;
}

/** Non-cache tokens using each source's output/reasoning semantics. */
export function getNonCacheTokens(
  usage: Pick<UsageBlock, "source" | "inputTokens" | "outputTokens" | "reasoningTokens">,
): number {
  return usage.inputTokens + usage.outputTokens +
    getAdditionalReasoningTokens(usage.source, usage.reasoningTokens);
}

// KV: token:{deviceToken} → UserRecord
export interface UserRecord {
  userId: string;
  displayName: string;
  /** Stable URL handle for /u/{slug}; assigned once, survives renames. */
  slug?: string;
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
  slug?: string;
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
  /** Highest accounting format accepted for this user's stored history. */
  syncFormatVersion?: number;
}

// Ranking entry
export interface RankingEntry {
  rank: number;
  userId: string;
  displayName: string;
  slug?: string;
  avatar: string;
  plan?: string;
  url?: string;
  totalTokens: number;
  /** Exact non-cache total; optional while older servers/caches age out. */
  nonCacheTokens?: number;
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
  /**
   * Monotonic accounting format. Once the server has accepted a version, it
   * rejects older or unversioned clients so they cannot restore stale totals.
   */
  syncFormatVersion?: number;
  /**
   * Sources whose stored history is atomically replaced by this request.
   * Full-sync clients use this to remove obsolete blocks that disappear after
   * parser or aggregation fixes; incremental clients omit it and merge.
   */
  replaceSources?: AgentSource[];
  /**
   * Sources this client durably tracks (config-derived, not the per-run
   * filter). The server prunes stored blocks of OPT_IN_SOURCES that are
   * absent here, so disabling an opt-in source also cleans up history.
   */
  trackedSources?: AgentSource[];
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

/**
 * The agent most members of a group used on one day, by head count. Reported
 * for each elapsed day of the current week; `winners` is empty when nobody
 * coded, and holds several sources only on an exact tie.
 */
export interface DayWinner {
  day: string;
  winners: AgentSource[];
  counts: Array<{ source: AgentSource; users: number }>;
}

// API: GET /api/rank/:code
export interface RankResponse {
  group: { name: string; code: string; memberCount: number };
  period: RankingPeriod;
  start: string;
  end: string;
  rankings: RankingEntry[];
  /** Monday-through-today of the viewer's local week; absent on old caches. */
  weekWinners?: DayWinner[];
}
