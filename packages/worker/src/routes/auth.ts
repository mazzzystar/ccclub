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
} from "@ccclub/shared";

const app = new Hono<{ Bindings: Env }>();

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

async function generateUniqueInviteCode(kv: KVNamespace, maxRetries = 5): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    const code = generateInviteCode();
    const existing = await kv.get(`group:${code}`);
    if (!existing) return code;
  }
  throw new Error("failed to generate unique invite code");
}

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

  // Add to group if not already member
  if (!group.members.some((m) => m.userId === user.userId)) {
    group.members.push({ userId: user.userId, displayName: user.displayName, avatar: user.avatar || "", joinedAt: now });
    await c.env.KV.put(`group:${code}`, JSON.stringify(group));
  }

  // Track user's groups
  const userGroups = (await c.env.KV.get<string[]>(`user_groups:${user.userId}`, "json")) || [];
  if (!userGroups.includes(code)) {
    userGroups.push(code);
    await c.env.KV.put(`user_groups:${user.userId}`, JSON.stringify(userGroups));
  }

  return c.json<JoinResponse>({ userId: user.userId, groupCode: code, groupName: group.name });
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
  });
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
  });
});

export { app as authRoutes };
