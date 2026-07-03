import { Hono } from "hono";
import type { Env } from "../types.js";
import type {
  InitRequest,
  InitResponse,
  JoinRequest,
  JoinResponse,
  UserRecord,
  GroupRecord,
  ProfileUpdateRequest,
  ProfileResponse,
  LeaveRequest,
  LeaveResponse,
  DeviceLinkCodeResponse,
  DeviceLinkRequest,
  DeviceLinkResponse,
  AccountMergeCodeResponse,
  AccountMergeRequest,
  AccountMergeResponse,
} from "@ccclub/shared";
import { registerUserDevice } from "../usage-store.js";
import {
  getUserDisplayRecord,
  mergeUserGroups,
  registerMergedUser,
  resolveCanonicalUserId,
} from "../identity-store.js";

const app = new Hono<{ Bindings: Env }>();
const DEVICE_LINK_TTL_SECONDS = 24 * 60 * 60;

function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
  let code = "";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (const b of bytes) code += chars[b % chars.length];
  return code;
}

function generateDeviceLinkCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (const b of bytes) code += chars[b % chars.length];
  return code;
}

async function generateUniqueInviteCode(kv: KVNamespace, maxRetries = 5): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    const code = generateInviteCode();
    const existing = await kv.get(`group:${code}`);
    if (!existing) return code;
  }
  throw new Error("failed to generate unique invite code");
}

async function generateUniqueDeviceLinkCode(kv: KVNamespace, maxRetries = 5): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    const code = generateDeviceLinkCode();
    const existing = await kv.get(`device_link:${code}`);
    if (!existing) return code;
  }
  throw new Error("failed to generate unique device link code");
}

async function generateUniqueAccountMergeCode(kv: KVNamespace, maxRetries = 5): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    const code = generateDeviceLinkCode();
    const existing = await kv.get(`account_merge:${code}`);
    if (!existing) return code;
  }
  throw new Error("failed to generate unique account merge code");
}

type DeviceLinkRecord = {
  userId: string;
  expiresAt: string;
};

type AccountMergeRecord = {
  targetUserId: string;
  expiresAt: string;
};

// POST /api/init - Create user + auto-create group
app.post("/init", async (c) => {
  const body = await c.req.json<InitRequest>();
  const { token, displayName } = body;

  if (!token || !displayName) {
    return c.json({ error: "token and displayName required" }, 400);
  }

  if (displayName.length > 50) {
    return c.json({ error: "displayName too long (max 50)" }, 400);
  }

  // Check if token already exists
  const existing = await c.env.KV.get<UserRecord>(`token:${token}`, "json");
  if (existing) {
    // Return existing user's first group
    const groupCodes = await c.env.KV.get<string[]>(`user_groups:${existing.userId}`, "json");
    const code = groupCodes?.[0] || "";
    let groupName = "";
    if (code) {
      const group = await c.env.KV.get<GroupRecord>(`group:${code}`, "json");
      groupName = group?.name || "";
    }
    return c.json<InitResponse>({ userId: existing.userId, groupCode: code, groupName });
  }

  const userId = generateId();
  const inviteCode = await generateUniqueInviteCode(c.env.KV);
  const now = new Date().toISOString();
  const groupName = `${displayName}'s club`;

  // Create user
  const userRecord: UserRecord = { userId, displayName, avatar: "", visibility: "private", createdAt: now };
  await c.env.KV.put(`token:${token}`, JSON.stringify(userRecord));

  // Create group with user as first member
  const groupRecord: GroupRecord = {
    name: groupName,
    code: inviteCode,
    createdBy: userId,
    createdAt: now,
    members: [{ userId, displayName, avatar: "", joinedAt: now }],
  };
  await c.env.KV.put(`group:${inviteCode}`, JSON.stringify(groupRecord));

  // Track user's groups
  await c.env.KV.put(`user_groups:${userId}`, JSON.stringify([inviteCode]));

  return c.json<InitResponse>({ userId, groupCode: inviteCode, groupName });
});

// POST /api/join - Create user (if new) + join group
app.post("/join", async (c) => {
  const body = await c.req.json<JoinRequest>();
  const { token, displayName, inviteCode } = body;

  if (!token || !displayName || !inviteCode) {
    return c.json({ error: "token, displayName, and inviteCode required" }, 400);
  }

  if (displayName.length > 50) {
    return c.json({ error: "displayName too long (max 50)" }, 400);
  }

  const code = inviteCode.toUpperCase();

  // Get group
  const group = await c.env.KV.get<GroupRecord>(`group:${code}`, "json");
  if (!group) {
    return c.json({ error: "invalid invite code" }, 404);
  }

  // Get or create user
  let user = await c.env.KV.get<UserRecord>(`token:${token}`, "json");
  const now = new Date().toISOString();

  if (!user) {
    const userId = generateId();
    user = { userId, displayName, avatar: "", visibility: "private", createdAt: now };
    await c.env.KV.put(`token:${token}`, JSON.stringify(user));
  }
  if (!user) {
    return c.json({ error: "failed to create user" }, 500);
  }
  const userRecord = user;

  // Add to group if not already member
  if (!group.members.some((m) => m.userId === userRecord.userId)) {
    group.members.push({ userId: userRecord.userId, displayName: userRecord.displayName, avatar: userRecord.avatar || "", joinedAt: now });
    await c.env.KV.put(`group:${code}`, JSON.stringify(group));
  }

  // Track user's groups
  const userGroups = (await c.env.KV.get<string[]>(`user_groups:${userRecord.userId}`, "json")) || [];
  if (!userGroups.includes(code)) {
    userGroups.push(code);
    await c.env.KV.put(`user_groups:${userRecord.userId}`, JSON.stringify(userGroups));
  }

  return c.json<JoinResponse>({ userId: userRecord.userId, groupCode: code, groupName: group.name });
});

// POST /api/group/create - Create a new group (for existing users)
app.post("/group/create", async (c) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const token = auth.slice(7);
  const user = await c.env.KV.get<UserRecord>(`token:${token}`, "json");
  if (!user) {
    return c.json({ error: "invalid token" }, 401);
  }

  const { name } = await c.req.json<{ name: string }>();
  if (!name) {
    return c.json({ error: "name required" }, 400);
  }
  if (name.length > 100) {
    return c.json({ error: "name too long (max 100)" }, 400);
  }

  const inviteCode = await generateUniqueInviteCode(c.env.KV);
  const now = new Date().toISOString();

  const groupRecord: GroupRecord = {
    name,
    code: inviteCode,
    createdBy: user.userId,
    createdAt: now,
    members: [{ userId: user.userId, displayName: user.displayName, avatar: user.avatar || "", joinedAt: now }],
  };
  await c.env.KV.put(`group:${inviteCode}`, JSON.stringify(groupRecord));

  const userGroups = (await c.env.KV.get<string[]>(`user_groups:${user.userId}`, "json")) || [];
  userGroups.push(inviteCode);
  await c.env.KV.put(`user_groups:${user.userId}`, JSON.stringify(userGroups));

  return c.json({ groupCode: inviteCode, groupName: name });
});

// POST /api/device/link-code - Create a short-lived code for linking another terminal
app.post("/device/link-code", async (c) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const token = auth.slice(7);
  const user = await c.env.KV.get<UserRecord>(`token:${token}`, "json");
  if (!user) {
    return c.json({ error: "invalid token" }, 401);
  }

  const code = await generateUniqueDeviceLinkCode(c.env.KV);
  const expiresAt = new Date(Date.now() + DEVICE_LINK_TTL_SECONDS * 1000).toISOString();
  const record: DeviceLinkRecord = {
    userId: user.userId,
    expiresAt,
  };

  await c.env.KV.put(`device_link:${code}`, JSON.stringify(record), { expirationTtl: DEVICE_LINK_TTL_SECONDS });

  return c.json<DeviceLinkCodeResponse>({ code, expiresAt });
});

// POST /api/device/link - Link this terminal to an existing ccclub user
app.post("/device/link", async (c) => {
  const body = await c.req.json<DeviceLinkRequest>();
  const code = body.code?.toUpperCase();
  const token = body.token;
  const deviceId = body.deviceId;

  if (!code || !token || !deviceId) {
    return c.json({ error: "code, token, and deviceId required" }, 400);
  }
  if (deviceId.length > 80) {
    return c.json({ error: "deviceId too long (max 80)" }, 400);
  }

  const link = await c.env.KV.get<DeviceLinkRecord>(`device_link:${code}`, "json");
  if (!link) {
    return c.json({ error: "invalid or expired link code" }, 404);
  }
  if (new Date(link.expiresAt).getTime() <= Date.now()) {
    await c.env.KV.delete(`device_link:${code}`);
    return c.json({ error: "link code expired" }, 410);
  }

  const existingToken = await c.env.KV.get<UserRecord>(`token:${token}`, "json");
  if (existingToken && existingToken.userId !== link.userId) {
    return c.json({ error: "token is already linked to another user" }, 409);
  }

  const userGroups = (await c.env.KV.get<string[]>(`user_groups:${link.userId}`, "json")) || [];
  const userRecord = await getUserDisplayRecord(c.env.KV, link.userId);

  await c.env.KV.put(`token:${token}`, JSON.stringify(userRecord));
  await registerUserDevice(c.env.KV, link.userId, deviceId);
  await c.env.KV.delete(`device_link:${code}`);

  return c.json<DeviceLinkResponse>({
    userId: link.userId,
    displayName: userRecord.displayName,
    groups: userGroups,
    deviceId,
  });
});

// POST /api/account/merge-code - Create a short-lived code for merging another existing account into this one
app.post("/account/merge-code", async (c) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const token = auth.slice(7);
  const user = await c.env.KV.get<UserRecord>(`token:${token}`, "json");
  if (!user) {
    return c.json({ error: "invalid token" }, 401);
  }

  const targetUserId = await resolveCanonicalUserId(c.env.KV, user.userId);
  const code = await generateUniqueAccountMergeCode(c.env.KV);
  const expiresAt = new Date(Date.now() + DEVICE_LINK_TTL_SECONDS * 1000).toISOString();
  const record: AccountMergeRecord = { targetUserId, expiresAt };

  await c.env.KV.put(`account_merge:${code}`, JSON.stringify(record), { expirationTtl: DEVICE_LINK_TTL_SECONDS });

  return c.json<AccountMergeCodeResponse>({ code, expiresAt });
});

// POST /api/account/merge - Merge this authenticated account into the code owner
app.post("/account/merge", async (c) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const token = auth.slice(7);
  const sourceUser = await c.env.KV.get<UserRecord>(`token:${token}`, "json");
  if (!sourceUser) {
    return c.json({ error: "invalid token" }, 401);
  }

  const body = await c.req.json<AccountMergeRequest>();
  const code = body.code?.toUpperCase();
  if (!code) {
    return c.json({ error: "code required" }, 400);
  }

  const merge = await c.env.KV.get<AccountMergeRecord>(`account_merge:${code}`, "json");
  if (!merge) {
    return c.json({ error: "invalid or expired merge code" }, 404);
  }
  if (new Date(merge.expiresAt).getTime() <= Date.now()) {
    await c.env.KV.delete(`account_merge:${code}`);
    return c.json({ error: "merge code expired" }, 410);
  }

  const sourceUserId = await resolveCanonicalUserId(c.env.KV, sourceUser.userId);
  const targetUserId = await resolveCanonicalUserId(c.env.KV, merge.targetUserId);
  if (sourceUserId === targetUserId) {
    return c.json({ error: "accounts are already merged" }, 409);
  }

  await registerMergedUser(c.env.KV, sourceUserId, targetUserId);
  const groups = await mergeUserGroups(c.env.KV, targetUserId, sourceUserId);
  const targetRecord = await getUserDisplayRecord(c.env.KV, targetUserId);
  await c.env.KV.delete(`account_merge:${code}`);

  if (groups.length > 0) {
    await Promise.all(groups.map((groupCode) => c.env.KV.put(`last_sync:${groupCode}`, String(Date.now()))));
  }

  return c.json<AccountMergeResponse>({
    userId: targetUserId,
    displayName: targetRecord.displayName,
    groups,
    mergedUserId: sourceUserId,
  });
});

// POST /api/profile - Update user profile
app.post("/profile", async (c) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const token = auth.slice(7);
  const user = await c.env.KV.get<UserRecord>(`token:${token}`, "json");
  if (!user) {
    return c.json({ error: "invalid token" }, 401);
  }

  const body = await c.req.json<ProfileUpdateRequest>();

  if (body.displayName !== undefined && body.displayName.length > 50) {
    return c.json({ error: "displayName too long (max 50)" }, 400);
  }
  if (body.avatar !== undefined && body.avatar.length > 500) {
    return c.json({ error: "avatar URL too long (max 500)" }, 400);
  }
  if (body.visibility !== undefined && body.visibility !== "public" && body.visibility !== "private") {
    return c.json({ error: "visibility must be 'public' or 'private'" }, 400);
  }
  const validPlans = ["pro", "max100", "max200", "api", ""];
  if (body.plan !== undefined && !validPlans.includes(body.plan)) {
    return c.json({ error: "plan must be one of: pro, max100, max200, api (or empty to clear)" }, 400);
  }
  if (body.url !== undefined && body.url !== "" && (body.url.length > 200 || !body.url.startsWith("https://"))) {
    return c.json({ error: "URL must start with https:// and be at most 200 characters" }, 400);
  }

  const oldVisibility = user.visibility || "private";
  let changed = false;

  if (body.displayName !== undefined && body.displayName !== user.displayName) {
    user.displayName = body.displayName;
    changed = true;
  }
  if (body.avatar !== undefined && body.avatar !== user.avatar) {
    user.avatar = body.avatar;
    changed = true;
  }
  if (body.plan !== undefined) {
    const newPlan = body.plan || undefined;
    if (newPlan !== user.plan) {
      user.plan = newPlan;
      changed = true;
    }
  }
  if (body.url !== undefined) {
    const newUrl = body.url || undefined;
    if (newUrl !== user.url) {
      user.url = newUrl;
      changed = true;
    }
  }
  if (body.visibility !== undefined && body.visibility !== oldVisibility) {
    user.visibility = body.visibility;
  }

  // Save user record
  await c.env.KV.put(`token:${token}`, JSON.stringify(user));

  // Sync displayName/avatar to all groups where user is a member
  if (changed) {
    const userGroups = (await c.env.KV.get<string[]>(`user_groups:${user.userId}`, "json")) || [];
    for (const code of userGroups) {
      const group = await c.env.KV.get<GroupRecord>(`group:${code}`, "json");
      if (!group) continue;
      const member = group.members.find((m) => m.userId === user.userId);
      if (member) {
        member.displayName = user.displayName;
        member.avatar = user.avatar;
        member.plan = user.plan;
        member.url = user.url;
        await c.env.KV.put(`group:${code}`, JSON.stringify(group));
      }
    }
  }

  // Manage public_users list
  if (body.visibility !== undefined && body.visibility !== oldVisibility) {
    const publicUsers = (await c.env.KV.get<string[]>("public_users", "json")) || [];
    if (body.visibility === "public" && !publicUsers.includes(user.userId)) {
      publicUsers.push(user.userId);
      await c.env.KV.put("public_users", JSON.stringify(publicUsers));
    } else if (body.visibility === "private") {
      const filtered = publicUsers.filter((id) => id !== user.userId);
      await c.env.KV.put("public_users", JSON.stringify(filtered));
    }
  }

  return c.json<ProfileResponse>({
    displayName: user.displayName,
    avatar: user.avatar,
    visibility: user.visibility || "private",
    plan: user.plan,
    url: user.url,
  });
});

// POST /api/leave - Leave a group
app.post("/leave", async (c) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const token = auth.slice(7);
  const user = await c.env.KV.get<UserRecord>(`token:${token}`, "json");
  if (!user) {
    return c.json({ error: "invalid token" }, 401);
  }

  const { inviteCode } = await c.req.json<LeaveRequest>();
  if (!inviteCode) {
    return c.json({ error: "inviteCode required" }, 400);
  }
  const code = inviteCode.toUpperCase();

  const group = await c.env.KV.get<GroupRecord>(`group:${code}`, "json");
  if (!group) {
    return c.json({ error: "group not found" }, 404);
  }

  // Check membership
  if (!group.members.some((m) => m.userId === user.userId)) {
    return c.json({ error: "you are not a member of this group" }, 400);
  }

  // Remove user from group members
  group.members = group.members.filter((m) => m.userId !== user.userId);
  if (group.members.length === 0) {
    // Last member left — delete the group entirely
    await c.env.KV.delete(`group:${code}`);
  } else {
    await c.env.KV.put(`group:${code}`, JSON.stringify(group));
  }

  // Remove group from user's group list
  const userGroups = (await c.env.KV.get<string[]>(`user_groups:${user.userId}`, "json")) || [];
  const updated = userGroups.filter((g) => g !== code);
  await c.env.KV.put(`user_groups:${user.userId}`, JSON.stringify(updated));

  return c.json<LeaveResponse>({ ok: true, groupName: group.name });
});

// GET /api/profile - Get current user profile
app.get("/profile", async (c) => {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const token = auth.slice(7);
  const user = await c.env.KV.get<UserRecord>(`token:${token}`, "json");
  if (!user) {
    return c.json({ error: "invalid token" }, 401);
  }

  return c.json<ProfileResponse>({
    displayName: user.displayName,
    avatar: user.avatar || "",
    visibility: user.visibility || "private",
    plan: user.plan,
    url: user.url,
  });
});

export { app as authRoutes };
