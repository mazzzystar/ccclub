import { describe, expect, it } from "vitest";
import type { GroupRecord, ProfileResponse, UserRecord } from "@ccclub/shared";
import type { Env } from "../types.js";
import { authRoutes } from "./auth.js";

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
