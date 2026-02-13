import { Hono } from "hono";
import type { Env } from "../types.js";
import type { UserRecord, UsageData, SyncResponse, UsageBlock } from "@ccclub/shared";

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

  const { blocks } = await c.req.json<{ blocks: UsageBlock[] }>();
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return c.json({ error: "blocks array required" }, 400);
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

  await c.env.KV.put(`usage:${user.userId}`, JSON.stringify(usageData));

  return c.json<SyncResponse>({ synced: blocks.length });
});

export { app as syncRoutes };
