import type { ModelPricing, PricingTable } from "./pricing.js";

/**
 * LiteLLM's community-maintained price feed — the same upstream ccusage uses,
 * so ccclub costs stay aligned with ccusage by construction.
 */
export const LITELLM_PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

// The full feed lists ~3000 models (~1.6 MB). Coding agents only ever report
// these families; filtering keeps the distributed table at a few kilobytes.
const INCLUDED_MODEL_ID = /^(claude-|gpt-|o[0-9]|codex-|gemini-[0-9]|deepseek)/;

// "chat" plus OpenAI's Responses API (Codex models). Excludes embeddings,
// audio, image, and rerank entries that happen to share a name prefix.
const INCLUDED_MODES = new Set(["chat", "responses"]);

// Feed prices are USD per token; reject anything above $0.01/token
// ($10k per MTok) as corrupt.
const MAX_PRICE_PER_TOKEN = 0.01;

interface RawLiteLLMEntry {
  mode?: unknown;
  input_cost_per_token?: unknown;
  output_cost_per_token?: unknown;
  cache_creation_input_token_cost?: unknown;
  cache_read_input_token_cost?: unknown;
}

function perMillion(costPerToken: number): number {
  // Round to 8 decimals of $/MTok to strip float noise from the ×1e6 scaling.
  return Math.round(costPerToken * 1e6 * 1e8) / 1e8;
}

function requiredPrice(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_PRICE_PER_TOKEN
    ? perMillion(value)
    : null;
}

function optionalPrice(value: unknown): number | null {
  return value == null ? 0 : requiredPrice(value);
}

function toModelPricing(entry: RawLiteLLMEntry): ModelPricing | null {
  const input = requiredPrice(entry.input_cost_per_token);
  const output = requiredPrice(entry.output_cost_per_token);
  // Anthropic's 5-minute ephemeral cache-write rate; long-lived (1h) cache
  // writes cost more but agent CLIs overwhelmingly use the default 5m TTL.
  const cacheCreation = optionalPrice(entry.cache_creation_input_token_cost);
  const cacheRead = optionalPrice(entry.cache_read_input_token_cost);
  if (input == null || output == null || cacheCreation == null || cacheRead == null) return null;
  return { input, output, cacheCreation, cacheRead };
}

/** FNV-1a over a canonical serialization; stable across key order and runtimes. */
function hashModels(models: Record<string, ModelPricing>): string {
  const canonical = JSON.stringify(
    Object.keys(models)
      .sort()
      .map((key) => [key, models[key].input, models[key].output, models[key].cacheCreation, models[key].cacheRead]),
  );
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${Object.keys(models).length}-${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Convert the raw LiteLLM feed into a compact PricingTable: relevant model
 * families only, USD per million tokens, sorted keys, content-hash version.
 * Returns null when the input is not shaped like the feed at all.
 *
 * Bare model IDs win over provider-prefixed duplicates ("gpt-5" over
 * "azure/gpt-5") because agent logs report bare IDs.
 */
export function buildPricingTableFromLiteLLM(raw: unknown, updatedAt: string): PricingTable | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;

  const bare: Record<string, ModelPricing> = {};
  const prefixed: Record<string, ModelPricing> = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === "sample_spec" || value == null || typeof value !== "object") continue;
    const entry = value as RawLiteLLMEntry;
    if (typeof entry.mode !== "string" || !INCLUDED_MODES.has(entry.mode)) continue;

    const id = key.slice(key.lastIndexOf("/") + 1).toLowerCase();
    if (!INCLUDED_MODEL_ID.test(id)) continue;
    const pricing = toModelPricing(entry);
    if (pricing == null) continue;

    const bucket = key.includes("/") ? prefixed : bare;
    bucket[id] ??= pricing;
  }

  const models: Record<string, ModelPricing> = { ...prefixed, ...bare };
  if (Object.keys(models).length === 0) return null;

  const sorted: Record<string, ModelPricing> = {};
  for (const key of Object.keys(models).sort()) sorted[key] = models[key];

  return { version: hashModels(sorted), updatedAt, source: "litellm", models: sorted };
}
