import { describe, expect, it } from "vitest";
import type { GroupRecord, ProfileResponse, UserRecord } from "@ccclub/shared";
import type { Env } from "../types.js";
import { authRoutes } from "./auth.js";

function testEnv(
  initial: Record<string, unknown>,
): { env: Env; values: Map<string, string>; puts: string[] } {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  const puts: string[] = [];
  const KV = {
    async get(key: string, type?: string) {
      const value = values.get(key) ?? null;
      return type === "json" && value != null ? JSON.parse(value) : value;
    },
    async put(key: string, value: string) {
      puts.push(key);
      values.set(key, value);
    },
    async delete(key: string) {
      values.delete(key);
    },
  } as unknown as KVNamespace;
  return { env: { KV }, values, puts };
}

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    userId: "user-1",
    displayName: "Test",
    avatar: "",
    visibility: "private",
    createdAt: "2026-07-24T00:00:00.000Z",
    ...overrides,
  };
}

async function postProfile(env: Env, body: unknown): Promise<Response> {
  return await authRoutes.request("/profile", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, env);
}

describe("POST /profile projects", () => {
  it("stores a valid list and echoes it back", async () => {
    const { env, values } = testEnv({ "token:test-token": user(), "user_groups:user-1": [] });

    const response = await postProfile(env, {
      projects: [{ name: "  ccclub  ", url: "https://ccclub.dev" }, { name: "notes" }],
    });

    expect(response.status).toBe(200);
    expect((await response.json<ProfileResponse>()).projects).toEqual([
      { name: "ccclub", url: "https://ccclub.dev" },
      { name: "notes" },
    ]);
    const stored = JSON.parse(values.get("token:test-token") ?? "{}") as UserRecord;
    expect(stored.projects).toEqual([{ name: "ccclub", url: "https://ccclub.dev" }, { name: "notes" }]);
  });

  it("stores only name and url, dropping unknown keys", async () => {
    const { env, values } = testEnv({ "token:test-token": user(), "user_groups:user-1": [] });

    const response = await postProfile(env, {
      projects: [{ name: "ccclub", url: "https://ccclub.dev", stars: 999, owner: { admin: true } }],
    });

    expect(response.status).toBe(200);
    const stored = JSON.parse(values.get("token:test-token") ?? "{}") as UserRecord;
    expect(stored.projects).toEqual([{ name: "ccclub", url: "https://ccclub.dev" }]);
  });

  it.each([
    ["more than five projects", Array.from({ length: 6 }, (_, i) => ({ name: `p${i}` }))],
    ["an overlong name", [{ name: "x".repeat(31) }]],
    ["an empty name", [{ name: "   " }]],
    ["a missing name", [{ url: "https://ccclub.dev" }]],
    ["a non-string name", [{ name: 42 }]],
    ["an http:// url", [{ name: "ccclub", url: "http://ccclub.dev" }]],
    ["a javascript: url", [{ name: "ccclub", url: "javascript:alert(1)" }]],
    ["an incomplete https url", [{ name: "ccclub", url: "https://" }]],
    ["an overlong url", [{ name: "ccclub", url: "https://" + "y".repeat(200) }]],
    ["duplicate names", [{ name: "ccclub" }, { name: "CCClub" }]],
    ["a non-array payload", { name: "ccclub" }],
    ["a string payload", "ccclub"],
    ["a non-object entry", ["ccclub"]],
  ])("rejects %s with a 400", async (_label, projects) => {
    const stored = user({ projects: [{ name: "kept" }] });
    const { env, values } = testEnv({ "token:test-token": stored, "user_groups:user-1": [] });

    const response = await postProfile(env, { projects });

    expect(response.status).toBe(400);
    expect(await response.json<{ error: string }>()).toHaveProperty("error");
    // A rejected request changes nothing.
    expect(JSON.parse(values.get("token:test-token") ?? "{}")).toEqual(stored);
  });

  it("accepts exactly five projects and clears the list on an empty array", async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ name: `p${i}` }));
    const { env, values } = testEnv({ "token:test-token": user(), "user_groups:user-1": [] });

    expect((await postProfile(env, { projects: five })).status).toBe(200);
    expect((JSON.parse(values.get("token:test-token") ?? "{}") as UserRecord).projects).toEqual(five);

    expect((await postProfile(env, { projects: [] })).status).toBe(200);
    expect((JSON.parse(values.get("token:test-token") ?? "{}") as UserRecord).projects).toBeUndefined();
  });

  it("propagates projects to the member record in every group", async () => {
    const group = (code: string): GroupRecord => ({
      name: `group ${code}`,
      code,
      createdBy: "user-1",
      createdAt: "2026-07-24T00:00:00.000Z",
      members: [
        { userId: "user-1", displayName: "Test", avatar: "", joinedAt: "2026-07-24T00:00:00.000Z" },
        { userId: "user-2", displayName: "Other", avatar: "", joinedAt: "2026-07-24T00:00:00.000Z" },
      ],
    });
    const { env, values } = testEnv({
      "token:test-token": user(),
      "user_groups:user-1": ["AAAAAA", "BBBBBB"],
      "group:AAAAAA": group("AAAAAA"),
      "group:BBBBBB": group("BBBBBB"),
    });

    await postProfile(env, { projects: [{ name: "ccclub", url: "https://ccclub.dev" }] });

    for (const code of ["AAAAAA", "BBBBBB"]) {
      const saved = JSON.parse(values.get(`group:${code}`) ?? "{}") as GroupRecord;
      expect(saved.members[0].projects).toEqual([{ name: "ccclub", url: "https://ccclub.dev" }]);
      expect(saved.members[1].projects).toBeUndefined();
      expect(values.get(`last_sync:${code}`)).toMatch(/^\d+$/);
    }
  });

  it("copies existing projects when a user joins or creates another group", async () => {
    const profile = user({
      plan: "pro",
      url: "https://example.com",
      projects: [{ name: "ccclub", url: "https://ccclub.dev" }],
    });
    const destination: GroupRecord = {
      name: "Destination",
      code: "ABCDEF",
      createdBy: "user-2",
      createdAt: "2026-07-24T00:00:00.000Z",
      members: [{ userId: "user-2", displayName: "Other", avatar: "", joinedAt: "2026-07-24T00:00:00.000Z" }],
    };
    const { env, values } = testEnv({
      "token:test-token": profile,
      "user_groups:user-1": [],
      "group:ABCDEF": destination,
    });

    const joinResponse = await authRoutes.request("/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "test-token", displayName: "Test", inviteCode: "ABCDEF" }),
    }, env);
    expect(joinResponse.status).toBe(200);
    const joined = JSON.parse(values.get("group:ABCDEF") ?? "{}") as GroupRecord;
    expect(joined.members[1]).toMatchObject({
      plan: "pro",
      url: "https://example.com",
      projects: [{ name: "ccclub", url: "https://ccclub.dev" }],
    });

    const createResponse = await authRoutes.request("/group/create", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "New group" }),
    }, env);
    expect(createResponse.status).toBe(200);
    const { groupCode } = await createResponse.json<{ groupCode: string }>();
    const created = JSON.parse(values.get(`group:${groupCode}`) ?? "{}") as GroupRecord;
    expect(created.members[0]).toMatchObject({
      plan: "pro",
      url: "https://example.com",
      projects: [{ name: "ccclub", url: "https://ccclub.dev" }],
    });
  });

  it("leaves projects alone when the field is absent", async () => {
    const { env, values } = testEnv({
      "token:test-token": user({ projects: [{ name: "kept" }] }),
      "user_groups:user-1": [],
    });

    const response = await postProfile(env, { displayName: "Renamed" });

    expect(response.status).toBe(200);
    expect((JSON.parse(values.get("token:test-token") ?? "{}") as UserRecord).projects).toEqual([{ name: "kept" }]);
  });

  it("repairs a stale group snapshot when the same project list is retried", async () => {
    const projects = [{ name: "ccclub", url: "https://ccclub.dev" }];
    const staleGroup: GroupRecord = {
      name: "Stale group",
      code: "AAAAAA",
      createdBy: "user-1",
      createdAt: "2026-07-24T00:00:00.000Z",
      members: [{ userId: "user-1", displayName: "Test", avatar: "", joinedAt: "2026-07-24T00:00:00.000Z" }],
    };
    const { env, values } = testEnv({
      "token:test-token": user({ projects }),
      "user_groups:user-1": ["AAAAAA"],
      "group:AAAAAA": staleGroup,
    });

    const response = await postProfile(env, { projects });

    expect(response.status).toBe(200);
    const repaired = JSON.parse(values.get("group:AAAAAA") ?? "{}") as GroupRecord;
    expect(repaired.members[0].projects).toEqual(projects);
    expect(values.get("last_sync:AAAAAA")).toMatch(/^\d+$/);
  });
});

describe("membership changes expire the group's cached board", () => {
  function group(members: GroupRecord["members"]): GroupRecord {
    return {
      name: "Test club",
      code: "ABCDEF",
      createdBy: "user-1",
      createdAt: "2026-07-24T00:00:00.000Z",
      members,
    };
  }

  const member = (userId: string, displayName: string): GroupRecord["members"][number] => ({
    userId,
    displayName,
    avatar: "",
    joinedAt: "2026-07-24T00:00:00.000Z",
  });

  async function postJson(env: Env, path: string, body: unknown, token?: string): Promise<Response> {
    return await authRoutes.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }, env);
  }

  it("bumps last_sync when a join actually adds a member", async () => {
    const { env, puts, values } = testEnv({
      "group:ABCDEF": group([member("user-1", "First")]),
      "token:new-token": user({ userId: "user-2", displayName: "Second" }),
    });

    const response = await postJson(env, "/join", {
      token: "new-token",
      displayName: "Second",
      inviteCode: "abcdef",
    });

    expect(response.status).toBe(200);
    expect(puts).toContain("last_sync:ABCDEF");
    expect(puts.filter((key) => key === "last_sync:ABCDEF")).toHaveLength(1);
    expect(values.get("last_sync:ABCDEF")).toMatch(/^\d+$/);
  });

  it("writes no bump when the joiner is already a member", async () => {
    const { env, puts } = testEnv({
      "group:ABCDEF": group([member("user-1", "First")]),
      "token:test-token": user(),
      "user_groups:user-1": ["ABCDEF"],
    });

    const response = await postJson(env, "/join", {
      token: "test-token",
      displayName: "Test",
      inviteCode: "ABCDEF",
    });

    expect(response.status).toBe(200);
    expect(puts).not.toContain("last_sync:ABCDEF");
  });

  it("bumps last_sync when a member leaves a group that survives", async () => {
    const { env, puts } = testEnv({
      "group:ABCDEF": group([member("user-1", "First"), member("user-2", "Second")]),
      "token:test-token": user(),
      "user_groups:user-1": ["ABCDEF"],
    });

    const response = await postJson(env, "/leave", { inviteCode: "ABCDEF" }, "test-token");

    expect(response.status).toBe(200);
    expect(puts).toContain("last_sync:ABCDEF");
  });

  it("bumps last_sync when the last member leaves and the group is deleted", async () => {
    // /rank/:code reads its cache before it reads `group:`, so the board has to
    // be expired or a deleted group keeps answering until the TTL runs out.
    const { env, puts, values } = testEnv({
      "group:ABCDEF": group([member("user-1", "First")]),
      "token:test-token": user(),
      "user_groups:user-1": ["ABCDEF"],
    });

    const response = await postJson(env, "/leave", { inviteCode: "ABCDEF" }, "test-token");

    expect(response.status).toBe(200);
    expect(values.has("group:ABCDEF")).toBe(false);
    expect(puts).toContain("last_sync:ABCDEF");
  });

  it("bumps last_sync for a freshly created group", async () => {
    const { env, puts } = testEnv({ "token:test-token": user(), "user_groups:user-1": [] });

    const response = await postJson(env, "/group/create", { name: "New club" }, "test-token");

    expect(response.status).toBe(200);
    const { groupCode } = await response.json<{ groupCode: string }>();
    expect(puts).toContain(`last_sync:${groupCode}`);
  });

  it("bumps last_sync for the group /init auto-creates", async () => {
    const { env, puts } = testEnv({});

    const response = await postJson(env, "/init", { token: "fresh-token", displayName: "Fresh" });

    expect(response.status).toBe(200);
    const { groupCode } = await response.json<{ groupCode: string }>();
    expect(puts).toContain(`last_sync:${groupCode}`);
  });
});

describe("GET /profile", () => {
  it("returns the stored projects", async () => {
    const { env } = testEnv({ "token:test-token": user({ projects: [{ name: "ccclub", url: "https://ccclub.dev" }] }) });

    const response = await authRoutes.request("/profile", {
      headers: { Authorization: "Bearer test-token" },
    }, env);

    expect(response.status).toBe(200);
    expect((await response.json<ProfileResponse>()).projects).toEqual([{ name: "ccclub", url: "https://ccclub.dev" }]);
  });
});
