import { Hono } from "hono";
import { PRICING_SNAPSHOT, parsePricingTable } from "@ccclub/shared";
import type { PricingTable } from "@ccclub/shared";
import type { Env } from "../types.js";

/** KV key holding the latest table published by the daily refresh cron. */
export const PRICING_KV_KEY = "pricing:current";

const app = new Hono<{ Bindings: Env }>();

async function loadActivePricingTable(env: Env): Promise<PricingTable> {
  const stored = await env.KV.get(PRICING_KV_KEY, "json");
  // The bundled snapshot serves until the first cron run, and again if the
  // KV copy is ever unreadable.
  return (stored != null && parsePricingTable(stored)) || PRICING_SNAPSHOT;
}

// GET /api/pricing — compact model price table for CLI cost calculation.
// Clients revalidate with If-None-Match so an unchanged table costs one 304.
app.get("/pricing", async (c) => {
  const table = await loadActivePricingTable(c.env);
  const etag = `"${table.version}"`;

  c.header("ETag", etag);
  c.header("Cache-Control", "public, max-age=3600");
  if (c.req.header("If-None-Match") === etag) {
    return c.body(null, 304);
  }
  return c.json(table);
});

export { app as pricingRoutes };
