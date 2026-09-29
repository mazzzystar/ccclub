import { Hono } from "hono";
import type { Env } from "../types.js";
import { AGENT_SOURCES } from "@ccclub/shared";
import type { UserRecord, UsageData, UsageSnapshot, SyncResponse, SyncRequest } from "@ccclub/shared";
import { mergeUsageBlocks } from "../usage-merge.js";

const app = new Hono<{ Bindings: Env }>();

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Whether two usage snapshots carry the same quota readings.
 *
 * `snapshotAt` is deliberately ignored. It is a clock reading the CLI
 * refreshes at least every 5 minutes, so comparing it would mean a
 * snapshot-carrying user — the common case — never reaches the no-op path
 * below, which is exactly the shape of an idle heartbeat we are here to make
 * free. Nothing ever reads `snapshotAt` back: POST /api/sync and POST
 * /api/usage write it and no reader consumes it, so letting a newer one ride
 * along unwritten until the percentages actually move costs nothing.
 *
 * Exported because POST /api/usage applies the very same guard.
 */
export function sameUsageLimits(
  a: UsageSnapshot | undefined,
  b: UsageSnapshot | undefined,
): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.fiveHour === b.fiveHour && a.sevenDay === b.sevenDay;
}

/**
 * Whether the record we are about to store carries nothing the stored one
 * already has.
 *
 * The heartbeat syncs every 5 minutes whether or not the user coded since, so
 * most uploads re-send blocks the server already holds: the merge reproduces
 * exactly what is stored, and the `usage:` put plus one `last_sync:<code>` put
 * per group are pure churn. Worse, those `last_sync:` bumps invalidate every
 * one of that user's group ranking caches, forcing a full per-member fan-out
 * on the next read. Skipping them is the difference between "a sync happened"
 * and "the numbers changed".
 *
 * `lastSync` is deliberately excluded from the comparison: it is a clock
 * reading, not data, and is the one field that differs on every single
 * request. The visible consequence is that `usage.lastSync` now means "last
 * sync that changed something"; it only ever surfaces as the last-active
 * fallback for a member with no usage blocks at all. `usageSnapshot.snapshotAt`
 * is excluded for the same reason — see `sameUsageLimits`, which compares the
 * two quota percentages and nothing else.
 *
 * Serialized comparison rather than a field-by-field walk: both sides come
 * from the same CLI serialization — the stored copy is a `JSON.stringify` of
 * an earlier upload, and `merged` reuses those very block objects for anything
 * this upload did not touch — so key order matches. Were it ever to differ,
 * the only cost is a write we could have skipped, never a write we should have
 * made.
 */
function isUnchanged(next: UsageData, stored: UsageData): boolean {
  // A record written by POST /api/usage carries only `usageSnapshot` — that
  // route spreads the existing object and adds the snapshot, so a user whose
  // first ever request was an idle heartbeat has a stored record with no
  // `blocks` at all. That is not "unchanged": this upload is the first one to
  // give them any, and reading `.length` off it would throw besides.
  if (!Array.isArray(stored.blocks)) return false;
  if (next.blocks.length !== stored.blocks.length) return false;
  if (next.syncFormatVersion !== stored.syncFormatVersion) return false;
  if (!sameUsageLimits(next.usageSnapshot, stored.usageSnapshot)) return false;
  return JSON.stringify(next.blocks) === JSON.stringify(stored.blocks);
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

  const {
    blocks,
    usageSnapshot,
    replaceSources,
    trackedSources,
    syncFormatVersion,
  } = await c.req.json<SyncRequest>();
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

  if (
    syncFormatVersion !== undefined &&
    (!Number.isSafeInteger(syncFormatVersion) || syncFormatVersion <= 0)
  ) {
    return c.json({ error: "invalid syncFormatVersion" }, 400);
  }

  if (
    !Array.isArray(blocks) ||
    (blocks.length === 0 && (!Array.isArray(replaceSources) || replaceSources.length === 0))
  ) {
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
  const stored = await c.env.KV.get<UsageData>(`usage:${user.userId}`, "json");
  const existing: UsageData = stored || { blocks: [], lastSync: "" };
  if (
    existing.syncFormatVersion != null &&
    (syncFormatVersion == null || syncFormatVersion < existing.syncFormatVersion)
  ) {
    return c.json({
      error: `client accounting format is outdated; update ccclub (requires ${existing.syncFormatVersion})`,
    }, 409);
  }

  // `existing.blocks ?? []` for the same reason: a stored record from
  // POST /api/usage has a snapshot and nothing else.
  const merged = mergeUsageBlocks(existing.blocks ?? [], blocks, { replaceSources, trackedSources });

  const usageData: UsageData = {
    blocks: merged,
    lastSync: new Date().toISOString(),
  };
  if (syncFormatVersion != null) {
    usageData.syncFormatVersion = Math.max(
      existing.syncFormatVersion ?? 0,
      syncFormatVersion,
    );
  } else if (existing.syncFormatVersion != null) {
    usageData.syncFormatVersion = existing.syncFormatVersion;
  }

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

  // Nothing new in this upload: skip the `usage:` put, every `last_sync:` bump
  // (each of which would force a full ranking recompute on the next read) and
  // the `user_groups:` read those bumps need. The response keeps its shape —
  // the CLI reads `synced` and nothing else — plus the contract's optional
  // `unchanged` flag for anyone watching the logs.
  if (stored != null && isUnchanged(usageData, stored)) {
    return c.json<SyncResponse>({ synced: blocks.length, unchanged: true });
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
