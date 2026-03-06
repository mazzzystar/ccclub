import { Hono } from "hono";
import type { Env } from "../types.js";
import type { UserRecord, UsageData, SyncResponse, SyncRequest, UsageBlock } from "@ccclub/shared";

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

  const { blocks, usageSnapshot } = await c.req.json<SyncRequest>();
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return c.json({ error: "blocks array required" }, 400);
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
  }

  // Get existing usage data
  const existing = (await c.env.KV.get<UsageData>(`usage:${user.userId}`, "json")) || {
    blocks: [],
    lastSync: "",
  };

  // Merge blocks - deduplicate by blockStart
  const blockMap = new Map<string, UsageBlock>();
  for (const b of existing.blocks) blockMap.set(b.blockStart, b);
  for (const b of blocks) blockMap.set(b.blockStart, b);

  const merged: UsageBlock[] = Array.from(blockMap.values()).sort(
    (a, b) => new Date(a.blockStart).getTime() - new Date(b.blockStart).getTime(),
  );

  const usageData: UsageData = {
    blocks: merged,
    lastSync: new Date().toISOString(),
  };

  if (
    usageSnapshot &&
    typeof usageSnapshot.fiveHour === "number" && isFinite(usageSnapshot.fiveHour) &&
    typeof usageSnapshot.sevenDay === "number" && isFinite(usageSnapshot.sevenDay) &&
    typeof usageSnapshot.snapshotAt === "string" && usageSnapshot.snapshotAt.length < 64
  ) {
    usageData.usageSnapshot = {
      fiveHour: Math.max(0, Math.min(100, usageSnapshot.fiveHour)),
      sevenDay: Math.max(0, Math.min(100, usageSnapshot.sevenDay)),
      snapshotAt: usageSnapshot.snapshotAt,
    };
  } else if (existing.usageSnapshot) {
    // Preserve previously stored snapshot if not sent this time
    usageData.usageSnapshot = existing.usageSnapshot;
  }

  await c.env.KV.put(`usage:${user.userId}`, JSON.stringify(usageData));

  return c.json<SyncResponse>({ synced: blocks.length });
});

export { app as syncRoutes };
