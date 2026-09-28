import type { Context } from "hono";
import type { UsageSnapshot } from "@ccclub/shared";
import type { Env } from "../types.js";
import { sameUsageLimits } from "./sync.js";

export async function usageRoute(c: Context<{ Bindings: Env }>) {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const user = await c.env.KV.get<{ userId: string }>(`token:${token}`, "json");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const { usageSnapshot } = await c.req.json<{ usageSnapshot?: unknown }>();

  if (
    !usageSnapshot ||
    typeof (usageSnapshot as any).fiveHour !== "number" ||
    typeof (usageSnapshot as any).sevenDay !== "number" ||
    typeof (usageSnapshot as any).snapshotAt !== "string"
  ) {
    return c.json({ error: "Invalid usageSnapshot" }, 400);
  }

  const snap = {
    fiveHour: Math.max(0, Math.min(100, (usageSnapshot as any).fiveHour)),
    sevenDay: Math.max(0, Math.min(100, (usageSnapshot as any).sevenDay)),
    snapshotAt: (usageSnapshot as any).snapshotAt as string,
  };

  const existing = (await c.env.KV.get<{ usageSnapshot?: UsageSnapshot }>(`usage:${user.userId}`, "json")) ?? {};

  // Same no-op guard as POST /api/sync, and for the same reason. This is the
  // idle branch of `ccclub sync`: with no new blocks to upload the CLI posts
  // here every 5 minutes and then immediately calls GET /api/rank/<code>. By
  // then the cached ranking is ~300 s old — past the age floor — so the
  // `last_sync:` bump below would win and force a full per-member fan-out,
  // every heartbeat, for a user who has not coded since. Quota percentages
  // that have not moved are not news; `snapshotAt` alone is a clock reading
  // nothing reads back, so it rides along until they do.
  if (sameUsageLimits(existing.usageSnapshot, snap)) {
    return c.json({ ok: true, unchanged: true });
  }

  await c.env.KV.put(`usage:${user.userId}`, JSON.stringify({ ...existing, usageSnapshot: snap }));

  // Invalidate rank cache so next fetch sees updated usage
  const groups = (await c.env.KV.get<string[]>(`user_groups:${user.userId}`, "json")) ?? [];
  if (groups.length > 0) {
    await Promise.all(groups.map((code) => c.env.KV.put(`last_sync:${code}`, String(Date.now()))));
  }

  return c.json({ ok: true });
}
