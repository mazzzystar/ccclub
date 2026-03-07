import type { Context } from "hono";
import type { Env } from "../types.js";

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

  const existing = (await c.env.KV.get<object>(`usage:${user.userId}`, "json")) ?? {};
  await c.env.KV.put(`usage:${user.userId}`, JSON.stringify({ ...existing, usageSnapshot: snap }));

  // Invalidate rank cache so next fetch sees updated usage
  const groups = (await c.env.KV.get<string[]>(`user_groups:${user.userId}`, "json")) ?? [];
  if (groups.length > 0) {
    await Promise.all(groups.map((code) => c.env.KV.put(`last_sync:${code}`, String(Date.now()))));
  }

  return c.json({ ok: true });
}
