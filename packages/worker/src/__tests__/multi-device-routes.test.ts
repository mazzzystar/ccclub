import { describe, expect, it, vi } from "vitest";
import type { GroupRecord, UsageBlock, UsageData, UserRecord } from "@ccclub/shared";
import { authRoutes } from "../routes/auth.js";
import { rankRoutes } from "../routes/rankings.js";
import { syncRoutes } from "../routes/sync.js";
import { dashboardRoute } from "../dashboard.js";

vi.mock("../og-utils.js", () => ({
  cachedPngResponse: async (_cacheUrl: string, producer: () => Promise<Uint8Array>) => new Response(await producer()),
  getColor: () => "#ffffff",
  hashCode: () => 1,
  htmlEsc: (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  latinOnly: (value: string) => value,
  ogCacheUrl: (_url: string, key: string) => key,
  renderToPng: async () => new Uint8Array(),
  sanitizeCode: (value: string) => value,
  svgEsc: (value: string) => value,
  truncate: (value: string) => value,
}));

class MemoryKV {
  private values = new Map<string, string>();

  async get<T = unknown>(key: string, type?: "json" | "text"): Promise<T | string | null> {
    const value = this.values.get(key);
    if (value == null) return null;
    if (type === "json") return JSON.parse(value) as T;
    return value;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function block(
  blockStart: string,
  totalTokens: number,
  costUSD: number,
  source: UsageBlock["source"] = "codex",
): UsageBlock {
  return {
    source,
    blockStart,
    blockEnd: new Date(new Date(blockStart).getTime() + 30 * 60 * 1000).toISOString(),
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens,
    costUSD,
    models: ["gpt-5"],
    entryCount: 1,
    chatCount: 1,
  };
}

async function seedUser(kv: KVNamespace): Promise<void> {
  const user: UserRecord = {
    userId: "user-a",
    displayName: "Alice",
    avatar: "",
    visibility: "private",
    createdAt: "2026-06-01T00:00:00.000Z",
  };
  const group: GroupRecord = {
    name: "Alice's club",
    code: "ABC123",
    createdBy: "user-a",
    createdAt: "2026-06-01T00:00:00.000Z",
    members: [{ userId: "user-a", displayName: "Alice", avatar: "", joinedAt: "2026-06-01T00:00:00.000Z" }],
  };

  await kv.put("token:token-a", JSON.stringify(user));
  await kv.put("group:ABC123", JSON.stringify(group));
  await kv.put("user_groups:user-a", JSON.stringify(["ABC123"]));
}

async function seedSecondUser(kv: KVNamespace, options: { sameGroup?: boolean; sourceOnlyGroup?: boolean; publicUsers?: boolean } = {}): Promise<void> {
  const user: UserRecord = {
    userId: "user-b",
    displayName: "Bob",
    avatar: "",
    visibility: options.publicUsers ? "public" : "private",
    createdAt: "2026-06-01T00:00:00.000Z",
  };
  await kv.put("token:token-b", JSON.stringify(user));

  const groups: string[] = [];
  if (options.sameGroup) {
    const group = await kv.get<GroupRecord>("group:ABC123", "json");
    if (!group) throw new Error("seedUser must run before seedSecondUser({ sameGroup: true })");
    group.members.push({ userId: "user-b", displayName: "Bob", avatar: "", joinedAt: "2026-06-01T00:00:00.000Z" });
    await kv.put("group:ABC123", JSON.stringify(group));
    groups.push("ABC123");
  }

  if (options.sourceOnlyGroup) {
    const group: GroupRecord = {
      name: "Bob's club",
      code: "BOB123",
      createdBy: "user-b",
      createdAt: "2026-06-01T00:00:00.000Z",
      members: [{ userId: "user-b", displayName: "Bob", avatar: "", joinedAt: "2026-06-01T00:00:00.000Z" }],
    };
    await kv.put("group:BOB123", JSON.stringify(group));
    groups.push("BOB123");
  }

  await kv.put("user_groups:user-b", JSON.stringify(groups));
  if (options.publicUsers) {
    await kv.put("public_users", JSON.stringify(["user-a", "user-b"]));
    const alice = await kv.get<UserRecord>("token:token-a", "json");
    if (alice) {
      alice.visibility = "public";
      await kv.put("token:token-a", JSON.stringify(alice));
    }
  }
}

async function seedMergedAccountUsage(kv: KVNamespace): Promise<void> {
  await kv.put("usage:user-a", JSON.stringify({
    blocks: [block("2026-06-01T00:00:00.000Z", 100, 1)],
    lastSync: "2026-06-01T00:10:00.000Z",
  } satisfies UsageData));
  await kv.put("usage:user-b", JSON.stringify({
    blocks: [block("2026-06-01T00:30:00.000Z", 50, 0.5)],
    lastSync: "2026-06-01T00:40:00.000Z",
  } satisfies UsageData));
  await kv.put("user_alias:user-b", "user-a");
  await kv.put("merged_users:user-a", JSON.stringify(["user-b"]));
}

describe("multi-device routes", () => {
  it("syncs device uploads into usage_device without touching legacy usage", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    await seedUser(kv);

    const res = await syncRoutes.request("/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token-a" },
      body: JSON.stringify({
        deviceId: "device-a",
        blocks: [block("2026-06-01T00:00:00.000Z", 100, 1)],
      }),
    }, { KV: kv });

    expect(res.status).toBe(200);
    expect(await kv.get<UsageData>("usage:user-a", "json")).toBeNull();
    expect(await kv.get<UsageData>("usage_device:user-a:device-a", "json")).toMatchObject({
      blocks: [{ blockStart: "2026-06-01T00:00:00.000Z", totalTokens: 100 }],
    });
    expect(await kv.get<string[]>("user_devices:user-a", "json")).toEqual(["device-a"]);
  });

  it("keeps legacy sync uploads on usage:{userId} when no deviceId is sent", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    await seedUser(kv);

    const res = await syncRoutes.request("/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token-a" },
      body: JSON.stringify({
        blocks: [block("2026-06-01T00:00:00.000Z", 100, 1)],
      }),
    }, { KV: kv });

    expect(res.status).toBe(200);
    expect(await kv.get<UsageData>("usage:user-a", "json")).toMatchObject({
      blocks: [{ blockStart: "2026-06-01T00:00:00.000Z", totalTokens: 100 }],
    });
    expect(await kv.get<UsageData>("usage_device:user-a:device-a", "json")).toBeNull();
  });

  it("rejects invalid device ids instead of falling back to legacy sync", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    await seedUser(kv);

    const res = await syncRoutes.request("/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token-a" },
      body: JSON.stringify({
        deviceId: "x".repeat(81),
        blocks: [block("2026-06-01T00:00:00.000Z", 100, 1)],
      }),
    }, { KV: kv });
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain("deviceId");
    expect(await kv.get<UsageData>("usage:user-a", "json")).toBeNull();
  });


  it("ranks legacy and linked device usage as one user", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    await seedUser(kv);
    await kv.put("usage:user-a", JSON.stringify({
      blocks: [block("2026-06-01T00:00:00.000Z", 100, 1)],
      lastSync: "2026-06-01T00:10:00.000Z",
    } satisfies UsageData));
    await kv.put("user_devices:user-a", JSON.stringify(["device-a"]));
    await kv.put("usage_device:user-a:device-a", JSON.stringify({
      blocks: [block("2026-06-01T00:30:00.000Z", 50, 0.5)],
      lastSync: "2026-06-01T00:40:00.000Z",
    } satisfies UsageData));

    const res = await rankRoutes.fetch(
      new Request("https://ccclub.test/rank/ABC123?period=all-time"),
      { KV: kv },
      { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext,
    );
    const body = await res.json() as { rankings: Array<{ totalTokens: number; costUSD: number; chatCount: number }> };

    expect(res.status).toBe(200);
    expect(body.rankings[0]).toMatchObject({
      totalTokens: 150,
      costUSD: 1.5,
      chatCount: 2,
    });
  });

  it("creates a one-time link code for an authenticated user", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    await seedUser(kv);

    const res = await authRoutes.request("/device/link-code", {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
    }, { KV: kv });
    const body = await res.json() as { code: string; expiresAt: string };

    expect(res.status).toBe(200);
    expect(body.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(await kv.get(`device_link:${body.code}`, "json")).toMatchObject({
      userId: "user-a",
    });
  });

  it("links a new device token to an existing lightweight user", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    await seedUser(kv);
    await kv.put("device_link:ABCDEFGH", JSON.stringify({
      userId: "user-a",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }));

    const res = await authRoutes.request("/device/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "ABCDEFGH", token: "token-b", deviceId: "device-b" }),
    }, { KV: kv });
    const body = await res.json() as { userId: string; displayName: string; groups: string[]; deviceId: string };

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      userId: "user-a",
      displayName: "Alice",
      groups: ["ABC123"],
      deviceId: "device-b",
    });
    expect(await kv.get<UserRecord>("token:token-b", "json")).toMatchObject({
      userId: "user-a",
      displayName: "Alice",
    });
    expect(await kv.get<string[]>("user_devices:user-a", "json")).toEqual(["device-b"]);
    expect(await kv.get("device_link:ABCDEFGH", "json")).toBeNull();
  });

  it("creates a 24-hour one-time merge code for the account that should remain visible", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    await seedUser(kv);

    const res = await authRoutes.request("/account/merge-code", {
      method: "POST",
      headers: { Authorization: "Bearer token-a" },
    }, { KV: kv });
    const body = await res.json() as { code: string; expiresAt: string };

    expect(res.status).toBe(200);
    expect(body.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(await kv.get(`account_merge:${body.code}`, "json")).toMatchObject({
      targetUserId: "user-a",
    });
  });

  it("merges an existing account into the merge-code owner without moving old usage", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    await seedUser(kv);
    await seedSecondUser(kv, { sameGroup: true, sourceOnlyGroup: true });
    await kv.put("usage:user-b", JSON.stringify({
      blocks: [block("2026-06-01T00:30:00.000Z", 50, 0.5)],
      lastSync: "2026-06-01T00:40:00.000Z",
    } satisfies UsageData));
    await kv.put("account_merge:ABCDEFGH", JSON.stringify({
      targetUserId: "user-a",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }));

    const res = await authRoutes.request("/account/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token-b" },
      body: JSON.stringify({ code: "ABCDEFGH" }),
    }, { KV: kv });
    const body = await res.json() as { userId: string; displayName: string; groups: string[]; mergedUserId: string };

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      userId: "user-a",
      displayName: "Alice",
      groups: ["ABC123", "BOB123"],
      mergedUserId: "user-b",
    });
    expect(await kv.get("user_alias:user-b", "text")).toBe("user-a");
    expect(await kv.get<string[]>("merged_users:user-a", "json")).toEqual(["user-b"]);
    expect(await kv.get<UserRecord>("token:token-b", "json")).toMatchObject({
      userId: "user-b",
      displayName: "Bob",
    });
    expect(await kv.get<UsageData>("usage:user-b", "json")).toMatchObject({
      blocks: [{ totalTokens: 50 }],
    });
    expect(await kv.get("account_merge:ABCDEFGH", "json")).toBeNull();
  });

  it("shows one target account row when two existing accounts in the same group are merged", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    await seedUser(kv);
    await seedSecondUser(kv, { sameGroup: true });
    await seedMergedAccountUsage(kv);

    const res = await rankRoutes.fetch(
      new Request("https://ccclub.test/rank/ABC123?period=all-time"),
      { KV: kv },
      { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext,
    );
    const body = await res.json() as {
      group: { memberCount: number };
      rankings: Array<{ userId: string; displayName: string; totalTokens: number; costUSD: number; chatCount: number }>;
    };

    expect(res.status).toBe(200);
    expect(body.group.memberCount).toBe(1);
    expect(body.rankings).toHaveLength(1);
    expect(body.rankings[0]).toMatchObject({
      userId: "user-a",
      displayName: "Alice",
      totalTokens: 150,
      costUSD: 1.5,
      chatCount: 2,
    });
  });

  it("shows the target account in groups where only the merged source account is a member", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    await seedUser(kv);
    await seedSecondUser(kv, { sourceOnlyGroup: true });
    await seedMergedAccountUsage(kv);

    const res = await rankRoutes.fetch(
      new Request("https://ccclub.test/rank/BOB123?period=all-time"),
      { KV: kv },
      { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext,
    );
    const body = await res.json() as {
      group: { memberCount: number };
      rankings: Array<{ userId: string; displayName: string; totalTokens: number; costUSD: number }>;
    };

    expect(res.status).toBe(200);
    expect(body.group.memberCount).toBe(1);
    expect(body.rankings).toHaveLength(1);
    expect(body.rankings[0]).toMatchObject({
      userId: "user-a",
      displayName: "Alice",
      totalTokens: 150,
      costUSD: 1.5,
    });
  });

  it("deduplicates merged public accounts on the global leaderboard", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    await seedUser(kv);
    await seedSecondUser(kv, { sameGroup: true, publicUsers: true });
    await seedMergedAccountUsage(kv);
    await kv.put("public_users", JSON.stringify(["user-b", "user-a"]));

    const res = await rankRoutes.fetch(
      new Request("https://ccclub.test/rank/global?period=all-time"),
      { KV: kv },
      { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext,
    );
    const body = await res.json() as {
      group: { memberCount: number };
      rankings: Array<{ userId: string; displayName: string; totalTokens: number; costUSD: number }>;
    };

    expect(res.status).toBe(200);
    expect(body.group.memberCount).toBe(1);
    expect(body.rankings).toHaveLength(1);
    expect(body.rankings[0]).toMatchObject({
      userId: "user-a",
      displayName: "Alice",
      totalTokens: 150,
      costUSD: 1.5,
    });
  });

  it("deduplicates merged accounts in activity charts", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    await seedUser(kv);
    await seedSecondUser(kv, { sameGroup: true });
    await seedMergedAccountUsage(kv);

    const res = await rankRoutes.fetch(
      new Request("https://ccclub.test/activity/ABC123?range=30d"),
      { KV: kv },
      { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext,
    );
    const body = await res.json() as {
      series: Array<{ displayName: string; totalCost: number; blocks: Array<{ totalTokens: number; cost: number }> }>;
    };

    expect(res.status).toBe(200);
    expect(body.series).toHaveLength(1);
    expect(body.series[0].displayName).toBe("Alice");
    expect(body.series[0].totalCost).toBe(1.5);
    expect(body.series[0].blocks.reduce((sum, item) => sum + item.totalTokens, 0)).toBe(150);
  });

  it("uses the canonical member count in dashboard metadata", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    await seedUser(kv);
    await seedSecondUser(kv, { sameGroup: true });
    await seedMergedAccountUsage(kv);

    const res = await dashboardRoute.fetch(
      new Request("https://ccclub.test/g/ABC123"),
      { KV: kv },
    );
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("1 member competing on coding agent usage.");
    expect(html).not.toContain("2 members competing on coding agent usage.");
  });
});
