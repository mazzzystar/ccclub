import { describe, expect, it } from "vitest";
import type { GroupRecord, MemberProject, RankResponse, UsageBlock, UsageData } from "@ccclub/shared";
import type { Env } from "../types.js";
import {
  GLOBAL_RANK_CACHE_MIN_AGE_MS,
  RANK_CACHE_MIN_AGE_MS,
  canServeCachedRanking,
  rankRoutes,
} from "./rankings.js";

function nowBlock(): UsageBlock {
  const start = new Date();
  return {
    source: "claude",
    blockStart: start.toISOString(),
    blockEnd: new Date(start.getTime() + 1_800_000).toISOString(),
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 150,
    costUSD: 1,
    models: ["claude-sonnet-4"],
    entryCount: 1,
    chatCount: 1,
  };
}

/** Fake KV that records every key read and written, so a test can assert that
 *  a cache hit did no per-member fan-out at all. */
type PutRecord = { key: string; value: string; options?: KVNamespacePutOptions };

function testEnv(initial: Record<string, unknown>): { env: Env; values: Map<string, string>; gets: string[]; puts: PutRecord[] } {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  const gets: string[] = [];
  const puts: PutRecord[] = [];
  const KV = {
    async get(key: string, type?: string) {
      gets.push(key);
      const value = values.get(key) ?? null;
      return type === "json" && value != null ? JSON.parse(value) : value;
    },
    async put(key: string, value: string, options?: KVNamespacePutOptions) {
      puts.push({ key, value, options });
      values.set(key, value);
    },
  } as unknown as KVNamespace;
  return { env: { KV }, values, gets, puts };
}

const executionCtx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

/** An execution context whose `waitUntil` work can actually be awaited, so the
 *  cache a handler writes in the background is there for the next request. */
function testCtx(): { ctx: ExecutionContext; settled: () => Promise<unknown> } {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  return { ctx, settled: () => Promise.all(pending) };
}

const projects: MemberProject[] = [{ name: "ccclub", url: "https://github.com/mazzzystar/ccclub" }, { name: "notes" }];

function group(members: GroupRecord["members"]): GroupRecord {
  return {
    name: "Test club",
    code: "ABCDEF",
    createdBy: "user-1",
    createdAt: "2026-07-24T00:00:00.000Z",
    members,
  };
}

const usage: UsageData = { blocks: [nowBlock()], lastSync: new Date().toISOString() };

describe("GET /rank/:code", () => {
  it("carries each member's projects and omits the field when empty", async () => {
    const { env } = testEnv({
      "group:ABCDEF": group([
        { userId: "user-1", displayName: "With", avatar: "", projects, joinedAt: "2026-07-24T00:00:00.000Z" },
        { userId: "user-2", displayName: "Without", avatar: "", projects: [], joinedAt: "2026-07-24T00:00:00.000Z" },
      ]),
      "usage:user-1": usage,
      "usage:user-2": usage,
    });

    const response = await rankRoutes.request("/rank/ABCDEF", {}, env, executionCtx);

    expect(response.status).toBe(200);
    const data = await response.json() as RankResponse;
    const byName = Object.fromEntries(data.rankings.map((r) => [r.displayName, r]));
    expect(byName.With.projects).toEqual(projects);
    expect(byName.Without.projects).toBeUndefined();
  });
});

describe("GET /rank/global", () => {
  it("carries projects resolved from the user's first group", async () => {
    const { env } = testEnv({
      public_users: ["user-1"],
      "user_groups:user-1": ["ABCDEF"],
      "group:ABCDEF": group([
        { userId: "user-1", displayName: "With", avatar: "", projects, joinedAt: "2026-07-24T00:00:00.000Z" },
      ]),
      "usage:user-1": usage,
    });

    const response = await rankRoutes.request("/rank/global", {}, env, executionCtx);

    expect(response.status).toBe(200);
    const data = await response.json() as RankResponse;
    expect(data.rankings[0].projects).toEqual(projects);
  });
});

describe("ranking cache age floor", () => {
  const members: GroupRecord["members"] = [
    { userId: "user-1", displayName: "One", avatar: "", joinedAt: "2026-07-24T00:00:00.000Z" },
    { userId: "user-2", displayName: "Two", avatar: "", joinedAt: "2026-07-24T00:00:00.000Z" },
  ];
  const cached: RankResponse = {
    group: { name: "Test club", code: "ABCDEF", memberCount: 2 },
    period: "daily",
    start: "2026-07-24T00:00:00.000Z",
    end: "2026-07-25T00:00:00.000Z",
    rankings: [],
  };

  function env(cacheAgeMs: number, lastSyncAgeMs: number) {
    const now = Date.now();
    return testEnv({
      "group:ABCDEF": group(members),
      "usage:user-1": usage,
      "usage:user-2": usage,
      "rank_cache:v10:ABCDEF:daily:0": { data: cached, computedAt: now - cacheAgeMs },
      "last_sync:ABCDEF": now - lastSyncAgeMs,
    });
  }

  it("serves a cache younger than the floor although the heartbeat's own sync invalidated it", async () => {
    // The shape this exists for: POST /api/sync bumped last_sync a second ago,
    // then the same client asked for the ranking.
    const { env: e, gets } = env(10_000, 0);

    const response = await rankRoutes.request("/rank/ABCDEF?period=daily", {}, e, executionCtx);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(cached);
    expect(gets.filter((key) => key.startsWith("usage:"))).toEqual([]);
    expect(gets.filter((key) => key.startsWith("group:"))).toEqual([]);
  });

  it("recomputes once the cache is past the floor and a sync is newer", async () => {
    const { env: e, gets } = env(120_000, 60_000);

    const response = await rankRoutes.request("/rank/ABCDEF?period=daily", {}, e, executionCtx);

    expect(response.status).toBe(200);
    const data = await response.json() as RankResponse;
    expect(data.rankings).toHaveLength(2);
    expect(gets.filter((key) => key.startsWith("usage:"))).toEqual(["usage:user-1", "usage:user-2"]);
  });

  it("keeps the original rule past the floor: a cache newer than the last sync still serves", async () => {
    const { env: e, gets } = env(120_000, 300_000);

    const response = await rankRoutes.request("/rank/ABCDEF?period=daily", {}, e, executionCtx);

    expect(await response.json()).toEqual(cached);
    expect(gets.filter((key) => key.startsWith("usage:"))).toEqual([]);
  });

  it("applies the same floor to /activity/:code", async () => {
    const now = Date.now();
    const activity = { range: "24h", start: "2026-07-24T00:00:00.000Z", end: "2026-07-25T00:00:00.000Z", series: [] };
    const { env: e, gets } = testEnv({
      "group:ABCDEF": group(members),
      "usage:user-1": usage,
      "usage:user-2": usage,
      "activity_cache:ABCDEF:24h:0": { data: activity, computedAt: now - 10_000 },
      "last_sync:ABCDEF": now,
    });

    const response = await rankRoutes.request("/activity/ABCDEF", {}, e, executionCtx);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(activity);
    expect(gets.filter((key) => key.startsWith("usage:"))).toEqual([]);
  });

  it("recomputes /activity/:code past the floor when a sync is newer", async () => {
    // The floor is a floor, not a lease: past it the original rule decides for
    // the activity board exactly as it does for the ranking.
    const now = Date.now();
    const stale = { range: "24h", start: "2026-07-24T00:00:00.000Z", end: "2026-07-25T00:00:00.000Z", series: [] };
    const { env: e, gets } = testEnv({
      "group:ABCDEF": group(members),
      "usage:user-1": usage,
      "usage:user-2": usage,
      "activity_cache:ABCDEF:24h:0": { data: stale, computedAt: now - 120_000 },
      "last_sync:ABCDEF": now - 60_000,
    });

    const response = await rankRoutes.request("/activity/ABCDEF", {}, e, executionCtx);

    expect(response.status).toBe(200);
    const data = await response.json() as { series: unknown[] };
    expect(data.series).toHaveLength(2);
    expect(gets.filter((key) => key.startsWith("usage:"))).toEqual(["usage:user-1", "usage:user-2"]);
  });

  it("writes the group board's cache under the versioned key with the 600 s TTL", async () => {
    const { env: e, puts } = testEnv({
      "group:ABCDEF": group(members),
      "usage:user-1": usage,
      "usage:user-2": usage,
    });
    const { ctx, settled } = testCtx();

    const response = await rankRoutes.request("/rank/ABCDEF?period=daily", {}, e, ctx);

    expect(response.status).toBe(200);
    await settled();
    expect(puts.map((put) => put.key)).toEqual(["rank_cache:v10:ABCDEF:daily:0"]);
    // Past the floor a cache newer than the last sync serves until it expires,
    // so the TTL is the only bound on staleness there — part of the contract,
    // not an incidental argument.
    expect(puts[0].options).toEqual({ expirationTtl: 600 });
  });

  it("a rank request inside the floor can predate the caller's own sync", async () => {
    // The deliberate trade, pinned so nobody has to rediscover it from a
    // support thread: the cached board says 0, the member's stored usage says
    // 1, the sync that produced the 1 is recorded as newer than the cache —
    // and the cache still wins because it is younger than the floor. This is
    // the clause that turns ~6,000 fan-outs a day into a handful, and its
    // price is a few seconds of lag on the caller's own number.
    const now = Date.now();
    const preSync: RankResponse = {
      ...cached,
      rankings: [
        {
          rank: 1,
          userId: "user-1",
          displayName: "One",
          avatar: "",
          costUSD: 0,
          totalTokens: 0,
          nonCacheTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          models: [],
          chatCount: 0,
          entryCount: 0,
        },
      ],
    };
    const { env: e, gets } = testEnv({
      "group:ABCDEF": group(members),
      "usage:user-1": usage,
      "usage:user-2": usage,
      "rank_cache:v10:ABCDEF:daily:0": { data: preSync, computedAt: now - 5_000 },
      "last_sync:ABCDEF": now - 200,
    });

    const response = await rankRoutes.request("/rank/ABCDEF?period=daily", {}, e, executionCtx);

    const data = await response.json() as RankResponse;
    expect(data.rankings[0].costUSD).toBe(0);
    expect(gets.filter((key) => key.startsWith("usage:"))).toEqual([]);
  });
});

describe("GET /rank/global caching", () => {
  it("serves the second call from cache with no fan-out", async () => {
    const { env, gets, puts } = testEnv({
      public_users: ["user-1"],
      "user_groups:user-1": ["ABCDEF"],
      "group:ABCDEF": group([
        { userId: "user-1", displayName: "With", avatar: "", projects, joinedAt: "2026-07-24T00:00:00.000Z" },
      ]),
      "usage:user-1": usage,
    });
    const { ctx, settled } = testCtx();

    const first = await rankRoutes.request("/rank/global", {}, env, ctx);
    expect(first.status).toBe(200);
    const firstData = await first.json() as RankResponse;
    await settled();
    expect(puts.map((put) => put.key)).toEqual(["rank_cache:v10:global:daily:0"]);
    // The TTL is the only bound on a "past the floor but computedAt >= lastSync"
    // serve, so it is part of the contract, not an incidental argument.
    expect(puts[0].options).toEqual({ expirationTtl: 600 });

    gets.length = 0;
    const second = await rankRoutes.request("/rank/global", {}, env, ctx);

    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstData);
    expect(gets).toEqual(["rank_cache:v10:global:daily:0"]);
  });
});

describe("the global board's longer floor", () => {
  const cachedGlobal: RankResponse = {
    group: { name: "Global Rankings", code: "global", memberCount: 1 },
    period: "daily",
    start: "2026-09-29T00:00:00.000Z",
    end: "2026-09-30T00:00:00.000Z",
    rankings: [],
  };

  function globalEnv(cacheAgeMs: number) {
    return testEnv({
      public_users: ["user-1"],
      "user_groups:user-1": ["ABCDEF"],
      "group:ABCDEF": group([
        { userId: "user-1", displayName: "One", avatar: "", joinedAt: "2026-07-24T00:00:00.000Z" },
      ]),
      "usage:user-1": usage,
      "rank_cache:v10:global:daily:0": { data: cachedGlobal, computedAt: Date.now() - cacheAgeMs },
    });
  }

  it("serves an entry a group board would already have refused", async () => {
    // 200 s is well past RANK_CACHE_MIN_AGE_MS: this board holds its cache
    // longer precisely because it has no sync marker to fall back on.
    expect(GLOBAL_RANK_CACHE_MIN_AGE_MS).toBeGreaterThan(RANK_CACHE_MIN_AGE_MS);
    const { env, gets } = globalEnv(200_000);

    const response = await rankRoutes.request("/rank/global", {}, env, executionCtx);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(cachedGlobal);
    expect(gets.filter((key) => key.startsWith("usage:"))).toEqual([]);
    expect(gets.filter((key) => key.startsWith("user_groups:"))).toEqual([]);
  });

  it("recomputes once the entry is past 300 s", async () => {
    const { env, gets } = globalEnv(400_000);

    const response = await rankRoutes.request("/rank/global", {}, env, executionCtx);

    expect(response.status).toBe(200);
    const data = await response.json() as RankResponse;
    expect(data.rankings).toHaveLength(1);
    expect(gets).toContain("usage:user-1");
  });
});

describe("canServeCachedRanking", () => {
  const now = 1_800_000_000_000;

  it("refuses an unusable computedAt", () => {
    expect(canServeCachedRanking(Number.NaN, 0, now)).toBe(false);
    expect(canServeCachedRanking(Number.POSITIVE_INFINITY, 0, now)).toBe(false);
  });

  it("refuses a future-dated entry rather than treating skew as freshness", () => {
    expect(canServeCachedRanking(now + 1, 0, now)).toBe(false);
  });

  it("serves just under the floor and recomputes at it", () => {
    expect(canServeCachedRanking(now - (RANK_CACHE_MIN_AGE_MS - 1), now, now)).toBe(true);
    expect(canServeCachedRanking(now - RANK_CACHE_MIN_AGE_MS, now, now)).toBe(false);
  });

  it("falls back to the original rule past the floor", () => {
    const past = now - RANK_CACHE_MIN_AGE_MS - 1;
    expect(canServeCachedRanking(past, past, now)).toBe(true); // computedAt >= lastSync
    expect(canServeCachedRanking(past, past + 1, now)).toBe(false);
  });

  it("treats a board with no sync marker as fresh only within the floor", () => {
    expect(canServeCachedRanking(now - 1_000, null, now)).toBe(true);
    expect(canServeCachedRanking(now - RANK_CACHE_MIN_AGE_MS, null, now)).toBe(false);
  });

  it("applies whichever floor it is handed", () => {
    const age200s = now - 200_000;
    expect(canServeCachedRanking(age200s, null, now)).toBe(false);
    expect(canServeCachedRanking(age200s, null, now, GLOBAL_RANK_CACHE_MIN_AGE_MS)).toBe(true);
    expect(canServeCachedRanking(now - 400_000, null, now, GLOBAL_RANK_CACHE_MIN_AGE_MS)).toBe(false);
  });

  it("reads the clock itself when no `now` is injected", () => {
    // Only worth a test if the default clock decides something, so straddle
    // the floor: an entry a hair inside it serves against a newer sync, one a
    // hair past it does not.
    expect(canServeCachedRanking(Date.now() - (RANK_CACHE_MIN_AGE_MS - 5_000), Date.now())).toBe(true);
    expect(canServeCachedRanking(Date.now() - RANK_CACHE_MIN_AGE_MS - 1, Date.now())).toBe(false);
  });
});
