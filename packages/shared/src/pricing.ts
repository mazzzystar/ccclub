import { PRICING_SNAPSHOT } from "./pricing-snapshot.js";

/** Price of one model in USD per million tokens. */
export interface ModelPricing {
  input: number;
  output: number;
  /**
   * Cache-write price (Anthropic 5-minute ephemeral rate). Providers without a
   * separate cache-write price use 0.
   */
  cacheCreation: number;
  cacheRead: number;
}

/**
 * A versioned set of model prices. The same shape is used for the bundled
 * snapshot, the Worker's KV copy, the /api/pricing response, and the CLI's
 * local cache, so every layer can validate and swap tables freely.
 */
export interface PricingTable {
  /** Content hash of `models`; doubles as the HTTP ETag and change detector. */
  version: string;
  /** When the table content last changed (ISO 8601). */
  updatedAt: string;
  /** Provenance: "litellm" for live tables, "snapshot" for the bundled copy. */
  source: string;
  /** Normalized model ID (lowercase, no provider prefix) → price per MTok. */
  models: Record<string, ModelPricing>;
}

export type PricingMatchKind = "override" | "exact" | "family" | "default";

export interface ResolvedPricing {
  pricing: ModelPricing;
  match: PricingMatchKind;
}

export type CostCalculator = (
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
  reasoningTokens?: number,
) => number;

const ZERO_PRICING: ModelPricing = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };

// Models the upstream price feed does not know about. Checked before any table
// so a stale or wrong upstream entry can never override them.
const PRICING_OVERRIDES: Record<string, ModelPricing> = {
  // Codex cloud auto-review turns are not billed to the user.
  "codex-auto-review": ZERO_PRICING,
};

/**
 * Family fallback for model IDs with no exact price — typically a dated or
 * suffixed variant the price feed has not picked up yet (it usually catches up
 * within a day). Each pattern maps to a representative model whose price is
 * looked up in the active table first, then the bundled snapshot.
 */
const FAMILY_REPRESENTATIVES: Record<string, string> = {
  opus: "claude-opus-4-7",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
  "gpt-5.5": "gpt-5.5",
  "gpt-5.4-mini": "gpt-5.4-mini",
  "gpt-5.4-nano": "gpt-5.4-nano",
  "gpt-5.4": "gpt-5.4",
  "gpt-5.3-codex": "gpt-5.3-codex",
  "gpt-5.2-codex": "gpt-5.2-codex",
  "gpt-5.1-codex-mini": "gpt-5.1-codex-mini",
  "gpt-5.1-codex-max": "gpt-5.1-codex-max",
  "gpt-5.1-codex": "gpt-5.1-codex",
  "gpt-5-codex": "gpt-5-codex",
  "codex-mini": "codex-mini-latest",
  "gpt-5-mini": "gpt-5-mini",
  "gpt-5-nano": "gpt-5-nano",
  "gpt-5": "gpt-5",
  gpt: "gpt-5",
  o3: "gpt-5",
  o4: "gpt-5",
  gemini: "gemini-2.5-pro",
  deepseek: "deepseek-chat",
};

/**
 * Family patterns ordered longest-first so the most specific stem always wins
 * ("gpt-5.1-codex-mini" before "gpt-5.1-codex" before "gpt-5"), regardless of
 * declaration order above.
 */
export const FAMILY_RULES: ReadonlyArray<{ pattern: string; modelId: string }> =
  Object.entries(FAMILY_REPRESENTATIVES)
    .map(([pattern, modelId]) => ({ pattern, modelId }))
    .sort((a, b) => b.pattern.length - a.pattern.length || a.pattern.localeCompare(b.pattern));

/** Applied when nothing matches at all; sonnet-tier is the safest middle guess. */
export const DEFAULT_FALLBACK_MODEL = "claude-sonnet-4-6";

/**
 * Canonical lookup key for a model ID as reported by agent logs: lowercase,
 * without the pi-agent "[pi] " marker or provider prefixes such as
 * "openai/gpt-5" (OpenCode) or "openrouter/anthropic/claude-…".
 */
export function normalizeModelId(model: string): string {
  let id = model.trim().toLowerCase();
  if (id.startsWith("[pi] ")) id = id.slice("[pi] ".length);
  const lastSlash = id.lastIndexOf("/");
  if (lastSlash !== -1) id = id.slice(lastSlash + 1);
  return id;
}

function representativePricing(modelId: string, table: PricingTable): ModelPricing {
  // FAMILY_RULES reference snapshot models by construction (enforced by tests),
  // so ZERO_PRICING is unreachable in practice.
  return table.models[modelId] ?? PRICING_SNAPSHOT.models[modelId] ?? ZERO_PRICING;
}

/** Resolution order: overrides → exact table match → family fallback → default. */
export function resolveModelPricing(model: string, table: PricingTable): ResolvedPricing {
  const id = normalizeModelId(model);

  const override = PRICING_OVERRIDES[id];
  if (override != null) return { pricing: override, match: "override" };

  const exact = table.models[id];
  if (exact != null) return { pricing: exact, match: "exact" };

  for (const { pattern, modelId } of FAMILY_RULES) {
    if (id.includes(pattern)) {
      return { pricing: representativePricing(modelId, table), match: "family" };
    }
  }

  return { pricing: representativePricing(DEFAULT_FALLBACK_MODEL, table), match: "default" };
}

/**
 * Build a cost function bound to one pricing table. Resolution is memoized per
 * model string because log files repeat a handful of models millions of times.
 */
export function createCostCalculator(table: PricingTable): CostCalculator {
  const resolved = new Map<string, ModelPricing>();
  return (model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, reasoningTokens = 0) => {
    let pricing = resolved.get(model);
    if (pricing == null) {
      pricing = resolveModelPricing(model, table).pricing;
      resolved.set(model, pricing);
    }
    return (
      (inputTokens * pricing.input +
        (outputTokens + reasoningTokens) * pricing.output +
        cacheCreationTokens * pricing.cacheCreation +
        cacheReadTokens * pricing.cacheRead) /
      1_000_000
    );
  };
}

/** Overlay a fetched table on top of a base so base-only models survive. */
export function mergePricingTables(base: PricingTable, overlay: PricingTable): PricingTable {
  return { ...overlay, models: { ...base.models, ...overlay.models } };
}

// Upper bound in USD per MTok. Nothing legitimate comes close; anything above
// is a corrupt or malicious table entry.
const MAX_PRICE_PER_MTOK = 10_000;

function asValidPrice(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_PRICE_PER_MTOK
    ? value
    : null;
}

/**
 * Validate an untrusted value (HTTP response, KV content, cache file) as a
 * PricingTable. Entries with invalid prices are dropped; returns null when the
 * envelope is malformed or no valid model remains.
 */
export function parsePricingTable(value: unknown): PricingTable | null {
  if (value == null || typeof value !== "object") return null;
  const { version, updatedAt, source, models } = value as Record<string, unknown>;
  if (typeof version !== "string" || version === "") return null;
  if (typeof updatedAt !== "string" || updatedAt === "") return null;
  if (models == null || typeof models !== "object" || Array.isArray(models)) return null;

  const validModels: Record<string, ModelPricing> = {};
  for (const [model, raw] of Object.entries(models as Record<string, unknown>)) {
    if (raw == null || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const input = asValidPrice(entry.input);
    const output = asValidPrice(entry.output);
    const cacheCreation = asValidPrice(entry.cacheCreation);
    const cacheRead = asValidPrice(entry.cacheRead);
    if (input == null || output == null || cacheCreation == null || cacheRead == null) continue;
    validModels[model.toLowerCase()] = { input, output, cacheCreation, cacheRead };
  }
  if (Object.keys(validModels).length === 0) return null;

  return {
    version,
    updatedAt,
    source: typeof source === "string" ? source : "unknown",
    models: validModels,
  };
}
