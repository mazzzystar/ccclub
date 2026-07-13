import { LITELLM_PRICING_URL, buildPricingTableFromLiteLLM } from "@ccclub/shared";
import { PRICING_KV_KEY } from "./routes/pricing.js";
import type { Env } from "./types.js";

// Refuse to publish a table that lost most of its models — guards against
// upstream truncation or a feed format change silently wiping prices.
const MIN_EXPECTED_MODELS = 50;

const FETCH_TIMEOUT_MS = 30_000;

/**
 * Daily cron job: pull the LiteLLM price feed, reduce it to the compact table
 * served by /api/pricing, and publish it to KV when the content changed.
 * Every failure path keeps the previously published table.
 */
export async function refreshPricingTable(env: Env): Promise<void> {
  let raw: unknown;
  try {
    const res = await fetch(LITELLM_PRICING_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`pricing refresh: upstream returned HTTP ${res.status}`);
      return;
    }
    raw = await res.json();
  } catch (err) {
    console.error(`pricing refresh: fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const table = buildPricingTableFromLiteLLM(raw, new Date().toISOString());
  const modelCount = table == null ? 0 : Object.keys(table.models).length;
  if (table == null || modelCount < MIN_EXPECTED_MODELS) {
    console.error(`pricing refresh: rejected upstream table with ${modelCount} models`);
    return;
  }

  const existing = (await env.KV.get(PRICING_KV_KEY, "json")) as { version?: unknown } | null;
  if (existing?.version === table.version) {
    console.log(`pricing refresh: unchanged at version ${table.version}`);
    return;
  }

  await env.KV.put(PRICING_KV_KEY, JSON.stringify(table));
  console.log(`pricing refresh: published ${modelCount} models, version ${table.version}`);
}
