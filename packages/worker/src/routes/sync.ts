import { Hono } from "hono";
import type { Env } from "../types.js";
import { AGENT_SOURCES } from "@ccclub/shared";
import type { UserRecord, UsageData, SyncResponse, SyncRequest, UsageBlock } from "@ccclub/shared";
import { putDeviceUsageData, putLegacyUsageData, registerUserDevice } from "../usage-store.js";

const app = new Hono<{ Bindings: Env }>();

// POST /api/sync - Upload usage blocks
app.post("/sync", async (c) => {
  // Auth via Bearer token
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const token = auth.slice(7);
  const user = await c.env.KV.get<UserRecord>(`token:${token}`, "json");
  if (!user) {
    return c.json({ error: "invalid token" }, 401);
  }

  const { blocks, usageSnapshot, deviceId } = await c.req.json<SyncRequest>();
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return c.json({ error: "blocks array required" }, 400);
  }
  if (deviceId !== undefined && (typeof deviceId !== "string" || deviceId.length > 80)) {
    return c.json({ error: "invalid deviceId" }, 400);
  }

  // Cap blocks per request to prevent abuse
  if (blocks.length > 50_000) {
    return c.json({ error: "too many blocks (max 50000)" }, 400);
  }

  // Validate block fields
  for (const b of blocks) {
    if (typeof b.blockStart !== "string" || !b.blockStart) {
      return c.json({ error: "invalid block: missing blockStart" }, 400);
    }
    if (b.lastActivityAt !== undefined && typeof b.lastActivityAt !== "string") {
      return c.json({ error: "invalid block: invalid lastActivityAt" }, 400);
    }
    if (typeof b.totalTokens !== "number" || !isFinite(b.totalTokens) ||
        typeof b.costUSD !== "number" || !isFinite(b.costUSD) ||
        typeof b.inputTokens !== "number" || !isFinite(b.inputTokens) ||
        typeof b.outputTokens !== "number" || !isFinite(b.outputTokens) ||
        typeof b.entryCount !== "number" || !isFinite(b.entryCount)) {
      return c.json({ error: "invalid block: missing or invalid numeric fields" }, 400);
    }
    if (!Array.isArray(b.models)) {
      return c.json({ error: "invalid block: models must be an array" }, 400);
    }
    if (b.source !== undefined && !AGENT_SOURCES.includes(b.source)) {
      return c.json({ error: "invalid block: unknown source" }, 400);
    }
  }

  const write = { blocks, usageSnapshot: undefined as SyncRequest["usageSnapshot"] };

  if (
    usageSnapshot &&
    typeof usageSnapshot.fiveHour === "number" && isFinite(usageSnapshot.fiveHour) &&
    typeof usageSnapshot.sevenDay === "number" && isFinite(usageSnapshot.sevenDay) &&
    typeof usageSnapshot.snapshotAt === "string" && usageSnapshot.snapshotAt.length < 64
  ) {
    write.usageSnapshot = {
      fiveHour: Math.max(0, Math.min(100, usageSnapshot.fiveHour)),
      sevenDay: Math.max(0, Math.min(100, usageSnapshot.sevenDay)),
      snapshotAt: usageSnapshot.snapshotAt,
    };
  }

  if (deviceId) {
    await registerUserDevice(c.env.KV, user.userId, deviceId);
    await putDeviceUsageData(c.env.KV, user.userId, deviceId, write);
  } else {
    await putLegacyUsageData(c.env.KV, user.userId, write);
  }

  // Invalidate rank cache for all groups this user belongs to
  const userGroups = (await c.env.KV.get<string[]>(`user_groups:${user.userId}`, "json")) || [];
  if (userGroups.length > 0) {
    await Promise.all(
      userGroups.map((code) => c.env.KV.put(`last_sync:${code}`, String(Date.now())))
    );
  }

  return c.json<SyncResponse>({ synced: blocks.length });
});

export { app as syncRoutes };
