import { Hono } from "hono";
import type { Env } from "../types.js";
import { getNonCacheTokens, isRankedSource } from "@ccclub/shared";
import type {
  AgentSource,
  GroupRecord,
  MemberProject,
  UsageData,
  RankingEntry,
  RankingPeriod,
  RankResponse,
} from "@ccclub/shared";
import {
  castMemberVotes,
  currentWeekDays,
  dayIndexOf,
  isUncontested,
  lookbackWindowUtc,
  noteMemberBlock,
  previousWeekDays,
  resolveWeekWinners,
} from "../week-winners.js";
import type { MemberSourceDay, MemberWeek, WeekTally } from "../week-winners.js";
import { loadMemberParts, parseSyncMarker } from "../usage-version.js";
import type { MemberPart } from "../usage-version.js";

const app = new Hono<{ Bindings: Env }>();

const VALID_PERIODS: RankingPeriod[] = ["daily", "yesterday", "weekly", "monthly", "all-time"];
// v10: entries now carry the member's projects. v11: group entries also carry
// each member's part and the windows it was derived for (`GroupRankCache`).
// The key must move with the meaning, or cached entries keep serving the old
// numbers under the new label until they expire.
const RANK_CACHE_VERSION = "v11";

/**
 * How young a cached ranking has to be to win over a newer `last_sync:`
 * marker. Below this age the cached entry is served even though a sync landed
 * after it was computed; at or above it, the original `computedAt >= lastSync`
 * rule decides. Used by the per-group boards — `/rank/:code` and
 * `/activity/:code`; the global board has its own, longer floor below.
 *
 * Why there is a floor at all: the CLI heartbeat (LaunchAgent, `StartInterval`
 * 300) makes two calls back to back — `POST /api/sync`, which writes
 * `usage:<userId>` and bumps `last_sync:<code>` for every group the user is
 * in, and then `GET /api/rank/<code>?period=daily` for the statusline. The
 * second call therefore always arrived carrying a `lastSync` newer than the
 * cache the first call had just invalidated: a 100% miss rate. Each miss fans
 * out one `KV.get(usage:<member>)` per member — an 85-member group is 88 reads
 * per call, ~6,000 calls a day ~= 529k reads a day, about two thirds of this
 * account's entire KV read bill — and then writes a cache entry that nothing
 * ever read. The client that caused the invalidation is the same client asking
 * for the result one call later; it does not need its own write reflected
 * within the second.
 *
 * Why 15 s and not longer: with the no-op short-circuits in place
 * (`isUnchanged` in sync.ts, `sameUsageLimits` in usage.ts) a `last_sync:`
 * bump now means the numbers actually moved, so the floor is no longer damming
 * a flood of no-op heartbeats. Its whole remaining job is to cap the recompute
 * rate when real changes do arrive in a burst: at 15 s an 85-member group
 * recomputes at most 4 times a minute. Since recomputes carry unchanged
 * members over (`loadMemberParts`), each costs one `list` plus a read per
 * member who changed rather than one per member, so the ceiling is cheap; the
 * floor still holds it. Longer than that starts costing correctness instead, because the CLI
 * asks for `/api/rank/<code>` about 200 ms after its own `POST /api/sync`, and
 * a cache younger than the floor wins over that sync. At 15 s that blind spot
 * is a twentieth of the 5-minute heartbeat rather than a fifth of it, so a
 * member who just coded sees their own upload on the statusline nearly every
 * time.
 *
 * The trade that remains: a board can be up to 15 s behind the very latest
 * sync. Every client polls on a 5-minute cadence, so that sits well below the
 * resolution anyone can observe. It is not only syncs that wait: a profile edit
 * bumps the same `last_sync:` markers (auth.ts, "a profile write must expire
 * any entry computed from the old member snapshot"), so a renamed member or a
 * new avatar can also take up to 15 s to appear on a board.
 */
export const RANK_CACHE_MIN_AGE_MS = 15_000;

/**
 * The same floor for `/rank/global`, which needs a different number because it
 * has no `last_sync:` marker: nothing invalidates the public set, so for that
 * board the floor is not a tie-breaker against a newer sync — it is the entire
 * freshness rule, and the recompute interval it names is the only one there is.
 *
 * 5 minutes is what the two consumers already assume. The dashboard polls
 * `/api/rank/global` on a 5-minute `setInterval` (dashboard.ts, `load()`), and
 * the global OG image keys its cache on `Math.floor(Date.now() / 300_000)`
 * (dashboard.ts, `cacheVersion`), so a shorter floor would only buy recomputes
 * nobody fetches. Every miss costs one `usage:` plus one `user_groups:` read
 * per public user and a `group:` read per distinct group, which is why this is
 * the one board worth holding longer than the group ones.
 *
 * The 600 s TTL above it stays as the safety net: past this floor the entry is
 * refused, so the TTL only matters if nothing asks for the board at all.
 */
export const GLOBAL_RANK_CACHE_MIN_AGE_MS = 300_000;

/**
 * Whether a cached entry may be served. `lastSync` is the newest sync marker
 * for this board, or null when the board has none — the global leaderboard,
 * which nothing invalidates, so there the age floor is the whole freshness
 * rule. A future-dated `computedAt` (clock skew) is never treated as fresh.
 *
 * `minAgeMs` is the floor to apply, so the global board can hold its cache
 * five times longer than a group board without a second copy of this rule.
 */
export function canServeCachedRanking(
  computedAt: number,
  lastSync: number | null,
  now = Date.now(),
  minAgeMs = RANK_CACHE_MIN_AGE_MS,
): boolean {
  if (!Number.isFinite(computedAt)) return false;
  const age = now - computedAt;
  if (age < 0) return false;
  if (age < minAgeMs) return true;
  return lastSync !== null && computedAt >= lastSync;
}

type AgentTotals = { costUSD: number; totalTokens: number; nonCacheTokens: number; chatCount: number; entryCount: number };

function hasUsage(block: UsageData["blocks"][number]): boolean {
  return block.entryCount > 0 || block.totalTokens > 0 || block.costUSD > 0;
}

function getBlockActivityTime(block: UsageData["blocks"][number]): number {
  const lastActivity = new Date(block.lastActivityAt || "").getTime();
  if (Number.isFinite(lastActivity)) return lastActivity;
  const blockEnd = new Date(block.blockEnd || block.blockStart).getTime();
  if (Number.isFinite(blockEnd)) return blockEnd;
  const blockStart = new Date(block.blockStart).getTime();
  return Number.isFinite(blockStart) ? blockStart : 0;
}

function addAgentTotals(totals: Map<AgentSource, AgentTotals>, block: UsageData["blocks"][number]): void {
  const source = block.source ?? "claude";
  const current = totals.get(source) ?? { costUSD: 0, totalTokens: 0, nonCacheTokens: 0, chatCount: 0, entryCount: 0 };
  current.costUSD += block.costUSD;
  current.totalTokens += block.totalTokens;
  current.nonCacheTokens += getNonCacheTokens(block);
  current.chatCount += block.chatCount || 0;
  current.entryCount += block.entryCount;
  totals.set(source, current);
}

/** The time windows one group board is computed over. */
interface RankWindows {
  startMs: number;
  endMs: number;
  monthStartMs: number;
  monthEndMs: number;
  weekStartMs: number;
  weekEndMs: number;
  tz: number;
}

/**
 * Everything a group board needs from one member's `usage:` record for one
 * set of windows — a few hundred bytes in place of the whole history.
 * Display fields (name, avatar, plan, projects) are deliberately absent: they
 * come from the group record, which every recompute reads fresh.
 */
export interface MemberRankPart {
  totalTokens: number;
  nonCacheTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUSD: number;
  entryCount: number;
  chatCount: number;
  /** Cost over the monthly window, for the ROI column. */
  monthlyCost: number;
  models: string[];
  agents: AgentSource[];
  agentTotals: [AgentSource, AgentTotals][];
  lastActiveTime: number;
  lastActiveSource?: AgentSource;
  /** The member's week-bar tally: local day index -> source -> usage. */
  week: [number, [AgentSource, MemberSourceDay][]][];
  usageSnapshot?: UsageData["usageSnapshot"];
  lastSync?: string;
}

/** A group board's cache entry. Entries written before v11 carry only `data` and `computedAt`. */
interface GroupRankCache {
  data: RankResponse;
  computedAt: number;
  /** `rankWindowKey` of the windows `parts` were derived for. */
  window?: string;
  /** When every member was last read rather than carried over. */
  fullAt?: number;
  parts?: Record<string, MemberPart<MemberRankPart>>;
}

/**
 * Below this many members a recompute reads everyone instead of listing
 * versions first. A `list` is billed like ten reads once its monthly
 * allowance is used, so it only pays on boards wider than that.
 */
export const INCREMENTAL_MIN_MEMBERS = 8;

/**
 * How long parts may be carried from one recompute to the next before every
 * member is read again. Carrying is exact as long as every `usage:` write
 * carries a version, so this only bounds the cost of a write that somehow did
 * not (an older deployment mid-rollout, a hand edit): about one full read of
 * the largest group every half hour per board.
 */
export const RANK_FULL_REFRESH_MS = 30 * 60_000;

function rankWindowKey(w: RankWindows): string {
  return `${w.startMs}:${w.endMs}:${w.monthStartMs}:${w.weekStartMs}`;
}

/** The parts a recompute may reuse, or null when it must read every member. */
function carriedRankParts(
  cached: GroupRankCache | null,
  windowKey: string,
  memberCount: number,
  now: number,
): Record<string, MemberPart<MemberRankPart>> | null {
  if (memberCount < INCREMENTAL_MIN_MEMBERS) return null;
  if (!cached?.parts || cached.window !== windowKey || cached.fullAt == null) return null;
  if (!(now - cached.fullAt < RANK_FULL_REFRESH_MS)) return null;
  return cached.parts;
}

/** One member's contribution to a group board, from their stored usage. */
export function summarizeMemberUsage(usage: UsageData | null, w: RankWindows): MemberRankPart {
  let totalTokens = 0;
  let nonCacheTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let costUSD = 0;
  let entryCount = 0;
  let chatCount = 0;
  let monthlyCost = 0;
  let lastActiveTime = 0;
  let lastActiveSource: AgentSource | undefined;
  const models = new Set<string>();
  const agents = new Set<AgentSource>();
  const agentTotals = new Map<AgentSource, AgentTotals>();
  const memberWeek: MemberWeek = new Map();

  for (const block of usage?.blocks ?? []) {
    if (!isRankedSource(block.source)) continue;
    const blockSource = block.source ?? "claude";
    if (hasUsage(block)) {
      const activityTime = getBlockActivityTime(block);
      if (activityTime > lastActiveTime) {
        lastActiveTime = activityTime;
        lastActiveSource = blockSource;
      }
    }
    const blockTime = new Date(block.blockStart).getTime();
    if (hasUsage(block) && blockTime >= w.weekStartMs && blockTime < w.weekEndMs) {
      noteMemberBlock(memberWeek, dayIndexOf(blockTime, w.tz), blockSource, block.costUSD, block.totalTokens);
    }
    if (blockTime >= w.startMs && blockTime < w.endMs) {
      totalTokens += block.totalTokens;
      nonCacheTokens += getNonCacheTokens(block);
      inputTokens += block.inputTokens;
      outputTokens += block.outputTokens;
      reasoningTokens += block.reasoningTokens || 0;
      costUSD += block.costUSD;
      entryCount += block.entryCount;
      chatCount += block.chatCount || 0;
      for (const m of block.models) models.add(m);
      agents.add(blockSource);
      addAgentTotals(agentTotals, block);
    }
    if (blockTime >= w.monthStartMs && blockTime < w.monthEndMs) {
      monthlyCost += block.costUSD;
    }
  }

  const part: MemberRankPart = {
    totalTokens,
    nonCacheTokens,
    inputTokens,
    outputTokens,
    reasoningTokens,
    costUSD,
    entryCount,
    chatCount,
    monthlyCost,
    models: Array.from(models),
    agents: Array.from(agents),
    agentTotals: Array.from(agentTotals),
    lastActiveTime,
    week: Array.from(memberWeek, ([day, bySource]) => [day, Array.from(bySource)]),
  };
  if (lastActiveSource) part.lastActiveSource = lastActiveSource;
  if (usage?.usageSnapshot) part.usageSnapshot = usage.usageSnapshot;
  if (usage?.lastSync) part.lastSync = usage.lastSync;
  return part;
}

/** One member's blocks in an activity window: [t ms, cost, non-cache tokens, total tokens, chats], oldest first. */
export interface MemberActivityPart {
  blocks: [number, number, number, number, number][];
}

/** An activity board's cache entry; group one-day ranges also carry parts. */
interface ActivityCache {
  data: unknown;
  computedAt: number;
  window?: string;
  fullAt?: number;
  parts?: Record<string, MemberPart<MemberActivityPart>>;
}

export function summarizeMemberActivity(usage: UsageData | null, startMs: number, endMs: number): MemberActivityPart {
  const blocks: MemberActivityPart["blocks"] = [];
  for (const block of usage?.blocks ?? []) {
    if (!isRankedSource(block.source)) continue;
    const blockTime = new Date(block.blockStart).getTime();
    if (blockTime >= startMs && blockTime < endMs) {
      blocks.push([
        blockTime,
        Math.round(block.costUSD * 10000) / 10000,
        getNonCacheTokens(block),
        block.totalTokens,
        block.chatCount || 0,
      ]);
    }
  }
  blocks.sort((a, b) => a[0] - b[0]);
  return { blocks };
}

function buildAgentBreakdown(totals: Map<AgentSource, AgentTotals>, totalCostUSD: number, totalTokens: number): RankingEntry["agentBreakdown"] {
  const denominator = totalCostUSD > 0 ? totalCostUSD : totalTokens;
  return Array.from(totals.entries())
    .map(([source, value]) => {
      const numerator = totalCostUSD > 0 ? value.costUSD : value.totalTokens;
      return {
        source,
        costUSD: Math.round(value.costUSD * 10000) / 10000,
        totalTokens: value.totalTokens,
        nonCacheTokens: value.nonCacheTokens,
        chatCount: value.chatCount,
        entryCount: value.entryCount,
        percent: denominator > 0 ? Math.round((numerator / denominator) * 100) : 0,
      };
    })
    .sort((a, b) => b.percent - a.percent || b.costUSD - a.costUSD);
}

function parsePeriod(raw: string | undefined): RankingPeriod {
  if (raw && VALID_PERIODS.includes(raw as RankingPeriod)) return raw as RankingPeriod;
  return "daily";
}

function getDateRange(period: RankingPeriod, tzOffsetMin = 0): { start: Date; end: Date } {
  // Shift "now" into the user's local day by applying their tz offset
  const nowUtc = Date.now();
  const nowLocal = new Date(nowUtc + tzOffsetMin * 60_000);

  switch (period) {
    case "daily": {
      const s = new Date(nowLocal);
      s.setUTCHours(0, 0, 0, 0);
      // Shift back to real UTC
      return { start: new Date(s.getTime() - tzOffsetMin * 60_000), end: new Date(s.getTime() - tzOffsetMin * 60_000 + 86_400_000) };
    }
    case "yesterday": {
      const s = new Date(nowLocal);
      s.setUTCHours(0, 0, 0, 0);
      const todayUtc = s.getTime() - tzOffsetMin * 60_000;
      return { start: new Date(todayUtc - 86_400_000), end: new Date(todayUtc) };
    }
    case "weekly": {
      // Rolling 7-day window (today minus 6 days through end of today)
      const s = new Date(nowLocal);
      s.setUTCHours(0, 0, 0, 0);
      const todayUtc = s.getTime() - tzOffsetMin * 60_000;
      return { start: new Date(todayUtc - 6 * 86_400_000), end: new Date(todayUtc + 86_400_000) };
    }
    case "monthly": {
      // Rolling 30-day window (today minus 29 days through end of today)
      const s = new Date(nowLocal);
      s.setUTCHours(0, 0, 0, 0);
      const todayUtc = s.getTime() - tzOffsetMin * 60_000;
      return { start: new Date(todayUtc - 29 * 86_400_000), end: new Date(todayUtc + 86_400_000) };
    }
    case "all-time":
      return { start: new Date("2020-01-01"), end: new Date("2099-12-31") };
  }
}

// Shared by GET /api/rank/global and the server-rendered /g/global page.
export async function computeGlobalRankings(env: Env, period: RankingPeriod, tz: number): Promise<RankResponse> {
  const publicUsers = (await env.KV.get<string[]>("public_users", "json")) || [];

  if (publicUsers.length === 0) {
    return {
      group: { name: "Global Rankings", code: "global", memberCount: 0 },
      period,
      start: new Date().toISOString(),
      end: new Date().toISOString(),
      rankings: [],
    };
  }

  const { start, end } = getDateRange(period, tz);
  const startMs = start.getTime();
  const endMs = end.getTime();

  // Monthly range for ROI calculation
  const { start: monthStart, end: monthEnd } = getDateRange("monthly", tz);
  const monthStartMs = monthStart.getTime();
  const monthEndMs = monthEnd.getTime();
  const isMonthly = period === "monthly";

  // Fetch all usage data and user groups in parallel
  const [usageResults, groupsResults] = await Promise.all([
    Promise.all(publicUsers.map((id) => env.KV.get<UsageData>(`usage:${id}`, "json"))),
    Promise.all(publicUsers.map((id) => env.KV.get<string[]>(`user_groups:${id}`, "json"))),
  ]);

  // Fetch first group for each user (for display name + plan) in parallel
  const firstGroupCodes = groupsResults.map((g) => g?.[0]);
  const uniqueCodes = [...new Set(firstGroupCodes.filter(Boolean))] as string[];
  const groupMap = new Map<string, GroupRecord>();
  await Promise.all(
    uniqueCodes.map(async (code) => {
      const g = await env.KV.get<GroupRecord>(`group:${code}`, "json");
      if (g) groupMap.set(code, g);
    }),
  );

  // Resolve display info and check if any user has a plan
  const userInfos: Array<{ displayName: string; slug?: string; avatar: string; plan?: string; url?: string; projects?: MemberProject[] }> = [];
  for (let idx = 0; idx < publicUsers.length; idx++) {
    const userId = publicUsers[idx];
    let displayName = userId.slice(0, 8);
    let slug: string | undefined;
    let avatar = "";
    let plan: string | undefined;
    let url: string | undefined;
    let projects: MemberProject[] | undefined;
    const firstCode = firstGroupCodes[idx];
    if (firstCode) {
      const group = groupMap.get(firstCode);
      const member = group?.members.find((m) => m.userId === userId);
      if (member) {
        displayName = member.displayName;
        slug = member.slug;
        avatar = member.avatar || "";
        plan = member.plan;
        url = member.url;
        projects = member.projects;
      }
    }
    userInfos.push({ displayName, slug, avatar, plan, url, projects });
  }
  const hasPlan = userInfos.some((u) => u.plan);

  const entries: RankingEntry[] = [];

  for (let idx = 0; idx < publicUsers.length; idx++) {
    const userId = publicUsers[idx];
    const usage = usageResults[idx];
    const info = userInfos[idx];

    if (!usage) continue;

    let totalTokens = 0;
    let nonCacheTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let costUSD = 0;
    let entryCount = 0;
    let chatCount = 0;
    let monthlyCost = 0;
    let lastActiveTime = 0;
    let lastActiveSource: AgentSource | undefined;
    const models = new Set<string>();
    const agents = new Set<AgentSource>();
    const agentTotals = new Map<AgentSource, AgentTotals>();

    for (const block of usage.blocks) {
      if (!isRankedSource(block.source)) continue;
      const blockSource = block.source ?? "claude";
      if (hasUsage(block)) {
        const activityTime = getBlockActivityTime(block);
        if (activityTime > lastActiveTime) {
          lastActiveTime = activityTime;
          lastActiveSource = blockSource;
        }
      }
      const blockTime = new Date(block.blockStart).getTime();
      if (blockTime >= startMs && blockTime < endMs) {
        const source = blockSource;
        totalTokens += block.totalTokens;
        nonCacheTokens += getNonCacheTokens(block);
        inputTokens += block.inputTokens;
        outputTokens += block.outputTokens;
        reasoningTokens += block.reasoningTokens || 0;
        costUSD += block.costUSD;
        entryCount += block.entryCount;
        chatCount += block.chatCount || 0;
        for (const m of block.models) models.add(m);
        agents.add(source);
        addAgentTotals(agentTotals, block);
      }
      if (hasPlan && !isMonthly && blockTime >= monthStartMs && blockTime < monthEndMs) {
        monthlyCost += block.costUSD;
      }
    }

    if (totalTokens > 0 || entryCount > 0) {
      const entry: RankingEntry = {
        rank: 0,
        userId,
        displayName: info.displayName,
        slug: info.slug,
        avatar: info.avatar,
        totalTokens,
        nonCacheTokens,
        inputTokens,
        outputTokens,
        reasoningTokens,
        costUSD: Math.round(costUSD * 10000) / 10000,
        models: Array.from(models),
        agents: Array.from(agents),
        agentBreakdown: buildAgentBreakdown(agentTotals, costUSD, totalTokens),
        entryCount,
        chatCount,
      };
      if (info.plan) entry.plan = info.plan;
      if (info.url) entry.url = info.url;
      if (info.projects && info.projects.length > 0) entry.projects = info.projects;
      if (hasPlan) {
        entry.monthlyCostUSD = Math.round((isMonthly ? costUSD : monthlyCost) * 10000) / 10000;
      }
      if (usage?.usageSnapshot) entry.usageSnapshot = usage.usageSnapshot;
      if (usage?.lastSync) entry.lastSync = usage.lastSync;
      if (lastActiveTime > 0) entry.lastActiveAt = new Date(lastActiveTime).toISOString();
      if (lastActiveSource) entry.lastActiveSource = lastActiveSource;
      entries.push(entry);
    }
  }

  entries.sort((a, b) => b.costUSD - a.costUSD);
  entries.forEach((e, i) => (e.rank = i + 1));

  return {
    group: { name: "Global Rankings", code: "global", memberCount: publicUsers.length },
    period,
    start: start.toISOString(),
    end: end.toISOString(),
    rankings: entries,
  };
}

// GET /api/rank/global - Global public ranking (must be before :code route)
app.get("/rank/global", async (c) => {
  const period = parsePeriod(c.req.query("period"));
  const tz = parseInt(c.req.query("tz") || "0", 10) || 0;

  // Same cache entry shape, key scheme and TTL as /rank/:code. The key segment
  // is lowercase `global`, which no group code can collide with (those are
  // upper-cased before they reach the key). Nothing bumps a `last_sync:` marker
  // for the public set, so the age floor is this board's entire freshness rule:
  // recompute at most once every 5 minutes — the cadence both consumers
  // already poll at — and serve from cache in between. Until now this route had
  // no cache at all — every hit read one `usage:` and one `user_groups:` entry
  // per public user, plus a `group:` per distinct group.
  const tzBucket = Math.round(tz / 60);
  const cacheKey = `rank_cache:${RANK_CACHE_VERSION}:global:${period}:${tzBucket}`;
  const cacheEntry = await c.env.KV.get<{ data: RankResponse; computedAt: number }>(cacheKey, "json");
  if (
    cacheEntry &&
    canServeCachedRanking(cacheEntry.computedAt, null, Date.now(), GLOBAL_RANK_CACHE_MIN_AGE_MS)
  ) {
    return c.json(cacheEntry.data);
  }

  const result = await computeGlobalRankings(c.env, period, tz);

  // Store in cache (10 min TTL as safety net); non-blocking
  c.executionCtx.waitUntil(
    c.env.KV.put(cacheKey, JSON.stringify({ data: result, computedAt: Date.now() }), {
      expirationTtl: 600,
    })
  );

  return c.json<RankResponse>(result);
});

// GET /api/rank/:code
app.get("/rank/:code", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const period = parsePeriod(c.req.query("period"));
  const tz = parseInt(c.req.query("tz") || "0", 10) || 0;

  // Check KV-backed cache before doing O(N) reads.
  // Pre-existing and not fixed here: the key names the period but not the day,
  // so at a local midnight a `daily` board can serve the previous day's window
  // until either a newer `last_sync:` beats it or the 600 s TTL expires. The
  // age floor adds at most its own length to that window — past the floor the
  // original `computedAt >= lastSync` rule decides again, so the first sync
  // after midnight evicts the entry exactly as it did before.
  const tzBucket = Math.round(tz / 60);
  const cacheKey = `rank_cache:${RANK_CACHE_VERSION}:${code}:${period}:${tzBucket}`;
  const [cacheEntry, lastSyncStr] = await Promise.all([
    c.env.KV.get<GroupRankCache>(cacheKey, "json"),
    c.env.KV.get(`last_sync:${code}`, "text"),
  ]);
  const lastSync = parseSyncMarker(lastSyncStr).at;
  if (cacheEntry && canServeCachedRanking(cacheEntry.computedAt, lastSync)) {
    return c.json(cacheEntry.data);
  }

  const group = await c.env.KV.get<GroupRecord>(`group:${code}`, "json");
  if (!group) {
    return c.json({ error: "group not found" }, 404);
  }

  const { start, end } = getDateRange(period, tz);
  const startMs = start.getTime();
  const endMs = end.getTime();

  // Monthly range for ROI calculation
  const { start: monthStart, end: monthEnd } = getDateRange("monthly", tz);
  const monthStartMs = monthStart.getTime();
  const monthEndMs = monthEnd.getTime();
  const isMonthly = period === "monthly";

  // The week bar is period-independent, so it rides along on whichever
  // traversal the selected tab already pays for. Groups only — the global
  // board stays a plain leaderboard.
  const nowMs = Date.now();
  const week = lookbackWindowUtc(nowMs, tz);
  const weekTally: WeekTally = new Map();

  const windows: RankWindows = { startMs, endMs, monthStartMs, monthEndMs, weekStartMs: week.startMs, weekEndMs: week.endMs, tz };
  const windowKey = rankWindowKey(windows);
  const carryOver = carriedRankParts(cacheEntry, windowKey, group.members.length, nowMs);
  const parts = await loadMemberParts(
    c.env.KV,
    group.members.map((m) => m.userId),
    carryOver,
    parseSyncMarker(lastSyncStr).userId,
    (usage) => summarizeMemberUsage(usage, windows),
  );

  const hasPlan = group.members.some((m) => m.plan);
  const entries: RankingEntry[] = [];

  for (const member of group.members) {
    const part = parts[member.userId].p;

    // This member's week is complete: turn it into one vote per day they coded.
    castMemberVotes(weekTally, new Map(part.week.map(([day, bySource]) => [day, new Map(bySource)])));

    const entry: RankingEntry = {
      rank: 0,
      userId: member.userId,
      displayName: member.displayName,
      slug: member.slug,
      avatar: member.avatar || "",
      totalTokens: part.totalTokens,
      nonCacheTokens: part.nonCacheTokens,
      inputTokens: part.inputTokens,
      outputTokens: part.outputTokens,
      reasoningTokens: part.reasoningTokens,
      costUSD: Math.round(part.costUSD * 10000) / 10000,
      models: part.models,
      agents: part.agents,
      agentBreakdown: buildAgentBreakdown(new Map(part.agentTotals), part.costUSD, part.totalTokens),
      entryCount: part.entryCount,
      chatCount: part.chatCount,
    };
    if (member.plan) entry.plan = member.plan;
    if (member.url) entry.url = member.url;
    if (member.projects && member.projects.length > 0) entry.projects = member.projects;
    if (hasPlan) {
      entry.monthlyCostUSD = Math.round((isMonthly ? part.costUSD : part.monthlyCost) * 10000) / 10000;
    }
    if (part.usageSnapshot) entry.usageSnapshot = part.usageSnapshot;
    if (part.lastSync) entry.lastSync = part.lastSync;
    if (part.lastActiveTime > 0) entry.lastActiveAt = new Date(part.lastActiveTime).toISOString();
    if (part.lastActiveSource) entry.lastActiveSource = part.lastActiveSource;
    entries.push(entry);
  }

  entries.sort((a, b) => b.costUSD - a.costUSD);
  entries.forEach((e, i) => (e.rank = i + 1));

  // Two weeks of winners decide whether this group has a race at all; only
  // the current week is ever sent.
  const thisWeek = currentWeekDays(nowMs, tz);
  const lookback = resolveWeekWinners(weekTally, [...previousWeekDays(nowMs, tz), ...thisWeek]);

  const result: RankResponse = {
    group: { name: group.name, code: group.code, memberCount: group.members.length },
    period,
    start: start.toISOString(),
    end: end.toISOString(),
    rankings: entries,
  };
  if (!isUncontested(lookback)) {
    result.weekWinners = lookback.slice(-thisWeek.length);
  }

  // Store in cache (10 min TTL as safety net); non-blocking. The parts ride
  // along so the next recompute in this window reads only who changed.
  const stored: GroupRankCache = {
    data: result,
    computedAt: Date.now(),
    window: windowKey,
    fullAt: carryOver ? cacheEntry!.fullAt : nowMs,
    parts,
  };
  c.executionCtx.waitUntil(
    c.env.KV.put(cacheKey, JSON.stringify(stored), {
      expirationTtl: 600,
    })
  );

  return c.json<RankResponse>(result);
});

// GET /api/activity/:code?range=24h|yesterday|7d|30d&tz=N
app.get("/activity/:code", async (c) => {
  const rawCode = c.req.param("code");
  const isGlobal = rawCode.toLowerCase() === "global";
  const code = rawCode.toUpperCase();
  const rawRange = c.req.query("range") || "24h";
  const range = rawRange === "yesterday" ? "yesterday" : rawRange === "7d" ? "7d" : rawRange === "30d" ? "30d" : "24h";
  const tz = parseInt(c.req.query("tz") || "0", 10) || 0;

  // Check KV-backed cache before doing O(N) reads
  const tzBucket = Math.round(tz / 60);
  const activityCacheKey = `activity_cache:${code}:${range}:${tzBucket}`;
  const [activityCacheEntry, activityLastSyncStr] = await Promise.all([
    c.env.KV.get<ActivityCache>(activityCacheKey, "json"),
    c.env.KV.get(`last_sync:${code}`, "text"),
  ]);
  const activityLastSync = parseSyncMarker(activityLastSyncStr).at;
  if (activityCacheEntry && canServeCachedRanking(activityCacheEntry.computedAt, activityLastSync)) {
    return c.json(activityCacheEntry.data);
  }

  // Align time window to user's local day boundary (same logic as getDateRange)
  const nowUtc = Date.now();
  const nowLocal = new Date(nowUtc + tz * 60_000);
  const todayLocal = new Date(nowLocal);
  todayLocal.setUTCHours(0, 0, 0, 0);
  const todayUtc = todayLocal.getTime() - tz * 60_000;

  let startMs: number;
  let endMs: number;
  if (range === "30d") {
    startMs = todayUtc - 29 * 86_400_000;
    endMs = todayUtc + 86_400_000;
  } else if (range === "7d") {
    startMs = todayUtc - 6 * 86_400_000;
    endMs = todayUtc + 86_400_000;
  } else if (range === "yesterday") {
    startMs = todayUtc - 86_400_000;
    endMs = todayUtc;
  } else {
    startMs = todayUtc;
    endMs = todayUtc + 86_400_000;
  }

  // Get members + resolve display names
  const MAX_USERS = 10;
  let memberIds: string[] = [];
  const memberMap = new Map<string, { displayName: string; slug?: string; avatar: string; url?: string }>();

  if (isGlobal) {
    const publicUsers = (await c.env.KV.get<string[]>("public_users", "json")) || [];
    memberIds = publicUsers;

    // Resolve display names from each user's first group (same as /rank/global)
    const groupsResults = await Promise.all(
      memberIds.map((id) => c.env.KV.get<string[]>(`user_groups:${id}`, "json")),
    );
    const firstGroupCodes = groupsResults.map((g) => g?.[0]);
    const uniqueCodes = [...new Set(firstGroupCodes.filter(Boolean))] as string[];
    const groupMap = new Map<string, GroupRecord>();
    await Promise.all(
      uniqueCodes.map(async (gc) => {
        const g = await c.env.KV.get<GroupRecord>(`group:${gc}`, "json");
        if (g) groupMap.set(gc, g);
      }),
    );
    for (let idx = 0; idx < memberIds.length; idx++) {
      const uid = memberIds[idx];
      const fc = firstGroupCodes[idx];
      if (fc) {
        const grp = groupMap.get(fc);
        const mem = grp?.members.find((m) => m.userId === uid);
        if (mem) {
          memberMap.set(uid, { displayName: mem.displayName, slug: mem.slug, avatar: mem.avatar || "", url: mem.url });
          continue;
        }
      }
      memberMap.set(uid, { displayName: uid.slice(0, 8), avatar: "" });
    }
  } else {
    const group = await c.env.KV.get<GroupRecord>(`group:${code}`, "json");
    if (!group) return c.json({ error: "group not found" }, 404);
    for (const m of group.members) {
      memberIds.push(m.userId);
      memberMap.set(m.userId, { displayName: m.displayName, slug: m.slug, avatar: m.avatar || "", url: m.url });
    }
  }

  // A group's per-member series carry over between recomputes like the
  // ranking's parts do, for the one-day ranges the dashboard polls. Longer
  // ranges would store every member's month of blocks in the cache entry;
  // they are asked for rarely enough to just read everyone.
  const activityWindow = `${startMs}:${endMs}`;
  const carryActivity = !isGlobal &&
    (range === "24h" || range === "yesterday") &&
    memberIds.length >= INCREMENTAL_MIN_MEMBERS &&
    activityCacheEntry?.parts != null &&
    activityCacheEntry.window === activityWindow &&
    activityCacheEntry.fullAt != null &&
    nowUtc - activityCacheEntry.fullAt < RANK_FULL_REFRESH_MS;
  const parts = await loadMemberParts(
    c.env.KV,
    memberIds,
    carryActivity ? activityCacheEntry!.parts! : null,
    parseSyncMarker(activityLastSyncStr).userId,
    (usage) => summarizeMemberActivity(usage, startMs, endMs),
  );

  // Build per-user time series
  const series: Array<{
    userId: string;
    displayName: string;
    slug?: string;
    avatar: string;
    url?: string;
    totalCost: number;
    blocks: Array<{ t: string; cost: number; tokens: number; totalTokens: number; chats: number }>;
  }> = [];

  for (const userId of memberIds) {
    const parsed = parts[userId].p.blocks;
    const info = memberMap.get(userId) || { displayName: userId.slice(0, 8), avatar: "" };

    const totalCost = parsed.reduce((s, [, cost]) => s + cost, 0);
    const blocks = parsed.map(([t, cost, tokens, totalTokens, chats]) => ({
      t: new Date(t).toISOString(),
      cost,
      tokens,
      totalTokens,
      chats,
    }));

    series.push({ userId, slug: info.slug, displayName: info.displayName, avatar: info.avatar, url: info.url, totalCost, blocks });
  }

  // Sort by total cost descending, limit to top N
  series.sort((a, b) => b.totalCost - a.totalCost);
  const limited = series.filter((s) => s.blocks.length > 0).slice(0, MAX_USERS);

  const activityResult = { range, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), series: limited };

  const storedActivity: ActivityCache = { data: activityResult, computedAt: Date.now() };
  if (!isGlobal && (range === "24h" || range === "yesterday")) {
    storedActivity.window = activityWindow;
    storedActivity.fullAt = carryActivity ? activityCacheEntry!.fullAt : nowUtc;
    storedActivity.parts = parts;
  }
  c.executionCtx.waitUntil(
    c.env.KV.put(activityCacheKey, JSON.stringify(storedActivity), {
      expirationTtl: 600,
    })
  );

  return c.json(activityResult);
});

export { app as rankRoutes };
