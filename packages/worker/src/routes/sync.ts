import { Hono } from "hono";
import type { Env } from "../types.js";
import { AGENT_SOURCES } from "@ccclub/shared";
import type { UserRecord, UsageData, SyncResponse, SyncRequest } from "@ccclub/shared";
import { mergeUsageBlocks } from "../usage-merge.js";

const app = new Hono<{ Bindings: Env }>();

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

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

  const { blocks, usageSnapshot, replaceSources, trackedSources } = await c.req.json<SyncRequest>();
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return c.json({ error: "blocks array required" }, 400);
  }

  // Cap blocks per request to prevent abuse
  if (blocks.length > 50_000) {
    return c.json({ error: "too many blocks (max 50000)" }, 400);
  }

  if (
    replaceSources !== undefined &&
    (!Array.isArray(replaceSources) || replaceSources.some((source) => !AGENT_SOURCES.includes(source)))
  ) {
    return c.json({ error: "invalid replaceSources" }, 400);
  }

  if (
    trackedSources !== undefined &&
    (!Array.isArray(trackedSources) || trackedSources.some((source) => !AGENT_SOURCES.includes(source)))
  ) {
    return c.json({ error: "invalid trackedSources" }, 400);
  }

  // Validate block fields
  for (const b of blocks) {
    if (typeof b.blockStart !== "string" || !b.blockStart) {
      return c.json({ error: "invalid block: missing blockStart" }, 400);
    }
    if (b.lastActivityAt !== undefined && typeof b.lastActivityAt !== "string") {
      return c.json({ error: "invalid block: invalid lastActivityAt" }, 400);
    }
    if (!isNonNegativeFinite(b.totalTokens) ||
        !isNonNegativeFinite(b.costUSD) ||
        !isNonNegativeFinite(b.inputTokens) ||
        !isNonNegativeFinite(b.outputTokens) ||
        !isNonNegativeFinite(b.cacheCreationTokens) ||
        !isNonNegativeFinite(b.cacheReadTokens) ||
        !isNonNegativeFinite(b.entryCount) ||
        (b.reasoningTokens !== undefined && !isNonNegativeFinite(b.reasoningTokens)) ||
        (b.chatCount !== undefined && !isNonNegativeFinite(b.chatCount))) {
      return c.json({ error: "invalid block: missing or invalid numeric fields" }, 400);
    }
    if (
      b.cacheCreation1hTokens !== undefined &&
      (!isNonNegativeFinite(b.cacheCreation1hTokens) || b.cacheCreation1hTokens > b.cacheCreationTokens)
    ) {
      return c.json({ error: "invalid block: invalid 1h cache creation tokens" }, 400);
    }
    if (!Array.isArray(b.models)) {
      return c.json({ error: "invalid block: models must be an array" }, 400);
    }
    if (b.source !== undefined && !AGENT_SOURCES.includes(b.source)) {
      return c.json({ error: "invalid block: unknown source" }, 400);
    }
  }

  // Get existing usage data
  const existing = (await c.env.KV.get<UsageData>(`usage:${user.userId}`, "json")) || {
    blocks: [],
    lastSync: "",
  };

  const merged = mergeUsageBlocks(existing.blocks, blocks, { replaceSources, trackedSources });

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
