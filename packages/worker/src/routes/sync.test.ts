import { describe, expect, it } from "vitest";
import type { UsageBlock, UsageData, UserRecord } from "@ccclub/shared";
import type { Env } from "../types.js";
import { syncRoutes } from "./sync.js";

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

function testEnv(initial: Record<string, unknown>): { env: Env; values: Map<string, string> } {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  const KV = {
    async get(key: string, type?: string) {
      const value = values.get(key) ?? null;
      return type === "json" && value != null ? JSON.parse(value) : value;
    },
    async put(key: string, value: string) {
      values.set(key, value);
    },
  } as unknown as KVNamespace;
  return { env: { KV }, values };
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
