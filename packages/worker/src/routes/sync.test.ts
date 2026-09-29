import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { UsageBlock, UsageData, UsageSnapshot, UserRecord } from "@ccclub/shared";
import type { Env } from "../types.js";
import { sameUsageLimits, syncRoutes } from "./sync.js";
import { usageRoute } from "./usage.js";

/** POST /api/usage is a bare handler; give it a router so it can be requested. */
const usageRoutes = new Hono<{ Bindings: Env }>().post("/usage", usageRoute);

function block(source: "claude" | "codex", totalTokens: number): UsageBlock {
  return {
    source,
    blockStart: "2026-07-24T00:00:00.000Z",
    blockEnd: "2026-07-24T00:30:00.000Z",
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens,
    costUSD: 0,
    models: [],
    entryCount: 1,
  };
}

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

/** Keys written, in order — what the KV bill is actually made of. */
function putKeys(puts: PutRecord[]): string[] {
  return puts.map((put) => put.key);
}

const user: UserRecord = {
  userId: "user-1",
  displayName: "Test",
  avatar: "",
  visibility: "private",
  createdAt: "2026-07-24T00:00:00.000Z",
};

function post(body: unknown, env: Env) {
  return syncRoutes.request("/sync", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, env);
}

describe("POST /sync", () => {
  it("allows an authenticated full sync to replace a source with no blocks", async () => {
    const user: UserRecord = {
      userId: "user-1",
      displayName: "Test",
      avatar: "",
      visibility: "private",
      createdAt: "2026-07-24T00:00:00.000Z",
    };
    const usage: UsageData = {
      blocks: [block("codex", 100), block("claude", 200)],
      lastSync: "2026-07-24T00:00:00.000Z",
    };
    const { env, values } = testEnv({
      "token:test-token": user,
      "usage:user-1": usage,
      "user_groups:user-1": [],
    });

    const response = await syncRoutes.request("/sync", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        blocks: [],
        replaceSources: ["codex"],
        syncFormatVersion: 18,
      }),
    }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ synced: 0 });
    const stored = JSON.parse(values.get("usage:user-1") ?? "{}") as UsageData;
    expect(stored.blocks).toEqual([block("claude", 200)]);
    expect(stored.syncFormatVersion).toBe(18);
  });

  it("still rejects an empty incremental upload", async () => {
    const user: UserRecord = {
      userId: "user-1",
      displayName: "Test",
      avatar: "",
      visibility: "private",
      createdAt: "2026-07-24T00:00:00.000Z",
    };
    const { env } = testEnv({ "token:test-token": user });

    const response = await syncRoutes.request("/sync", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ blocks: [] }),
    }, env);

    expect(response.status).toBe(400);
  });

  it.each([
    ["unversioned", undefined],
    ["older", 17],
  ])("rejects an %s client after a newer accounting format was stored", async (_label, version) => {
    const user: UserRecord = {
      userId: "user-1",
      displayName: "Test",
      avatar: "",
      visibility: "private",
      createdAt: "2026-07-24T00:00:00.000Z",
    };
    const usage: UsageData = {
      blocks: [block("codex", 100)],
      lastSync: "2026-07-24T00:00:00.000Z",
      syncFormatVersion: 18,
    };
    const { env, values } = testEnv({
      "token:test-token": user,
      "usage:user-1": usage,
    });
    const body = {
      blocks: [block("codex", 999)],
      ...(version == null ? {} : { syncFormatVersion: version }),
    };

    const response = await syncRoutes.request("/sync", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }, env);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "client accounting format is outdated; update ccclub (requires 18)",
    });
    expect(JSON.parse(values.get("usage:user-1") ?? "{}")).toEqual(usage);
  });

  it("accepts a newer format and advances the stored monotonic guard", async () => {
    const user: UserRecord = {
      userId: "user-1",
      displayName: "Test",
      avatar: "",
      visibility: "private",
      createdAt: "2026-07-24T00:00:00.000Z",
    };
    const usage: UsageData = {
      blocks: [block("codex", 100)],
      lastSync: "2026-07-24T00:00:00.000Z",
      syncFormatVersion: 18,
    };
    const { env, values } = testEnv({
      "token:test-token": user,
      "usage:user-1": usage,
      "user_groups:user-1": [],
    });

    const response = await syncRoutes.request("/sync", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        blocks: [block("codex", 200)],
        syncFormatVersion: 19,
      }),
    }, env);

    expect(response.status).toBe(200);
    const stored = JSON.parse(values.get("usage:user-1") ?? "{}") as UsageData;
    expect(stored.syncFormatVersion).toBe(19);
    expect(stored.blocks).toEqual([block("codex", 200)]);
  });
});

describe("POST /sync no-op uploads", () => {
  const stored = (): UsageData => ({
    blocks: [block("codex", 100), block("claude", 200)],
    lastSync: "2026-07-24T00:00:00.000Z",
    syncFormatVersion: 18,
  });

  it("writes nothing when the merge reproduces what is already stored", async () => {
    const { env, gets, puts } = testEnv({
      "token:test-token": user,
      "usage:user-1": stored(),
      "user_groups:user-1": ["ABCDEF", "GHIJKL"],
    });

    const response = await post(
      { blocks: [block("codex", 100), block("claude", 200)], syncFormatVersion: 18 },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ synced: 2, unchanged: true });
    // No `usage:` put, no `last_sync:` bump for either group — and the
    // `user_groups:` read those bumps would have needed is skipped too.
    expect(putKeys(puts)).toEqual([]);
    expect(gets).not.toContain("user_groups:user-1");
  });

  it("writes usage and bumps every group when a block actually changed", async () => {
    const { env, values, puts } = testEnv({
      "token:test-token": user,
      "usage:user-1": stored(),
      "user_groups:user-1": ["ABCDEF", "GHIJKL"],
    });

    const response = await post(
      { blocks: [block("codex", 999), block("claude", 200)], syncFormatVersion: 18 },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ synced: 2 });
    expect(putKeys(puts)).toEqual(["usage:user-1", "last_sync:ABCDEF", "last_sync:GHIJKL"]);
    const next = JSON.parse(values.get("usage:user-1") ?? "{}") as UsageData;
    expect(next.blocks).toEqual([block("codex", 999), block("claude", 200)]);
  });

  it("still writes when a quota percentage moved", async () => {
    const withSnapshot: UsageData = {
      ...stored(),
      usageSnapshot: { fiveHour: 10, sevenDay: 20, snapshotAt: "2026-07-24T00:00:00.000Z" },
    };
    const { env, puts } = testEnv({
      "token:test-token": user,
      "usage:user-1": withSnapshot,
      "user_groups:user-1": ["ABCDEF"],
    });

    const response = await post(
      {
        blocks: [block("codex", 100), block("claude", 200)],
        syncFormatVersion: 18,
        usageSnapshot: { fiveHour: 55, sevenDay: 20, snapshotAt: "2026-07-24T01:00:00.000Z" },
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(putKeys(puts)).toContain("usage:user-1");
  });

  it("writes the first record for a user who has none yet", async () => {
    const { env, puts } = testEnv({
      "token:test-token": user,
      "user_groups:user-1": [],
    });

    const response = await post({ blocks: [block("codex", 100)], syncFormatVersion: 18 }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ synced: 1 });
    expect(putKeys(puts)).toEqual(["usage:user-1"]);
  });
});

describe("usage snapshot comparison", () => {
  const snap: UsageSnapshot = { fiveHour: 10, sevenDay: 20, snapshotAt: "2026-07-24T00:00:00.000Z" };

  it("ignores snapshotAt, which is a clock reading nothing reads back", () => {
    expect(sameUsageLimits(snap, { ...snap, snapshotAt: "2026-09-29T12:00:00.000Z" })).toBe(true);
  });

  it("notices either percentage moving", () => {
    expect(sameUsageLimits(snap, { ...snap, fiveHour: 11 })).toBe(false);
    expect(sameUsageLimits(snap, { ...snap, sevenDay: 21 })).toBe(false);
  });

  it("treats a missing snapshot as different from a present one", () => {
    expect(sameUsageLimits(undefined, snap)).toBe(false);
    expect(sameUsageLimits(snap, undefined)).toBe(false);
    expect(sameUsageLimits(undefined, undefined)).toBe(true);
  });
});

describe("POST /sync with a snapshot", () => {
  const stored = (snapshot: UsageSnapshot): UsageData => ({
    blocks: [block("codex", 100)],
    lastSync: "2026-07-24T00:00:00.000Z",
    syncFormatVersion: 18,
    usageSnapshot: snapshot,
  });

  it("skips the writes when only snapshotAt advanced", async () => {
    const { env, puts } = testEnv({
      "token:test-token": user,
      "usage:user-1": stored({ fiveHour: 10, sevenDay: 20, snapshotAt: "2026-07-24T00:00:00.000Z" }),
      "user_groups:user-1": ["ABCDEF"],
    });

    const response = await post({
      blocks: [block("codex", 100)],
      syncFormatVersion: 18,
      usageSnapshot: { fiveHour: 10, sevenDay: 20, snapshotAt: "2026-09-29T12:00:00.000Z" },
    }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ synced: 1, unchanged: true });
    expect(putKeys(puts)).toEqual([]);
  });
});

describe("POST /usage", () => {
  const body = (snapshot: UsageSnapshot) => ({ usageSnapshot: snapshot });

  function post(payload: unknown, env: Env) {
    return usageRoutes.request("/usage", {
      method: "POST",
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, env);
  }

  it("writes nothing when the quota percentages have not moved", async () => {
    const { env, gets, puts } = testEnv({
      "token:test-token": user,
      "usage:user-1": {
        blocks: [block("codex", 100)],
        lastSync: "2026-07-24T00:00:00.000Z",
        usageSnapshot: { fiveHour: 10, sevenDay: 20, snapshotAt: "2026-07-24T00:00:00.000Z" },
      },
      "user_groups:user-1": ["ABCDEF", "GHIJKL"],
    });

    const response = await post(
      body({ fiveHour: 10, sevenDay: 20, snapshotAt: "2026-09-29T12:00:00.000Z" }),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, unchanged: true });
    expect(putKeys(puts)).toEqual([]);
    expect(gets).not.toContain("user_groups:user-1");
  });

  it("writes and invalidates every group when a percentage moved", async () => {
    const { env, values, puts } = testEnv({
      "token:test-token": user,
      "usage:user-1": {
        blocks: [block("codex", 100)],
        lastSync: "2026-07-24T00:00:00.000Z",
        usageSnapshot: { fiveHour: 10, sevenDay: 20, snapshotAt: "2026-07-24T00:00:00.000Z" },
      },
      "user_groups:user-1": ["ABCDEF", "GHIJKL"],
    });

    const response = await post(
      body({ fiveHour: 42, sevenDay: 20, snapshotAt: "2026-09-29T12:00:00.000Z" }),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(putKeys(puts)).toEqual(["usage:user-1", "last_sync:ABCDEF", "last_sync:GHIJKL"]);
    const next = JSON.parse(values.get("usage:user-1") ?? "{}") as UsageData;
    expect(next.usageSnapshot).toEqual({ fiveHour: 42, sevenDay: 20, snapshotAt: "2026-09-29T12:00:00.000Z" });
    // The blocks the record already held survive the snapshot-only write.
    expect(next.blocks).toEqual([block("codex", 100)]);
  });

  it("writes the first snapshot for a user with no stored usage", async () => {
    const { env, puts } = testEnv({ "token:test-token": user, "user_groups:user-1": [] });

    const response = await post(
      body({ fiveHour: 5, sevenDay: 5, snapshotAt: "2026-09-29T12:00:00.000Z" }),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(putKeys(puts)).toEqual(["usage:user-1"]);
  });

  it("leaves a record a later first sync can still merge into", async () => {
    // The record this route writes for a brand-new user has a snapshot and no
    // `blocks` key at all. POST /api/sync then reads it as its `existing`, and
    // both `mergeUsageBlocks` and `isUnchanged` used to reach straight into
    // `.blocks`: the first real upload from anyone whose install idled before
    // it ever coded threw on the way in.
    const { env, values } = testEnv({ "token:test-token": user, "user_groups:user-1": ["ABCDEF"] });

    const idle = await post(
      body({ fiveHour: 5, sevenDay: 5, snapshotAt: "2026-09-29T12:00:00.000Z" }),
      env,
    );
    expect(idle.status).toBe(200);
    const afterIdle = JSON.parse(values.get("usage:user-1") ?? "{}") as Partial<UsageData>;
    expect(afterIdle.blocks).toBeUndefined();

    const synced = await syncRoutes.request("/sync", {
      method: "POST",
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: [block("claude", 100)], syncFormatVersion: 18 }),
    }, env);

    expect(synced.status).toBe(200);
    expect(await synced.json()).toEqual({ synced: 1 });
    const stored = JSON.parse(values.get("usage:user-1") ?? "{}") as UsageData;
    expect(stored.blocks).toEqual([block("claude", 100)]);
    // And the snapshot the idle post left behind is not lost on the way.
    expect(stored.usageSnapshot).toEqual({
      fiveHour: 5,
      sevenDay: 5,
      snapshotAt: "2026-09-29T12:00:00.000Z",
    });
  });
});
