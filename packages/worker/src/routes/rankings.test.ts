import { describe, expect, it } from "vitest";
import type { GroupRecord, MemberProject, RankResponse, UsageBlock, UsageData } from "@ccclub/shared";
import type { Env } from "../types.js";
import { rankRoutes } from "./rankings.js";

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

function testEnv(initial: Record<string, unknown>): Env {
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
  return { KV };
}

const executionCtx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

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
    const env = testEnv({
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
    const env = testEnv({
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
