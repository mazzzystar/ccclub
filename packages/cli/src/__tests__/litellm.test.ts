import { describe, it, expect } from "vitest";
import { buildPricingTableFromLiteLLM } from "@ccclub/shared";

const UPDATED_AT = "2026-01-01T00:00:00.000Z";

const FEED = {
  sample_spec: { mode: "chat", input_cost_per_token: 1 },
  "gpt-5": {
    mode: "chat",
    input_cost_per_token: 0.00000125,
    output_cost_per_token: 0.00001,
    cache_read_input_token_cost: 1.25e-7,
  },
  "gpt-5-codex": {
    mode: "responses",
    input_cost_per_token: 0.00000125,
    output_cost_per_token: 0.00001,
    cache_read_input_token_cost: 1.25e-7,
  },
  "claude-sonnet-4-6": {
    mode: "chat",
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    cache_creation_input_token_cost: 0.00000375,
    cache_read_input_token_cost: 3e-7,
  },
  "gpt-4o-mini-tts": {
    mode: "audio_speech",
    input_cost_per_token: 0.0000006,
    output_cost_per_token: 0.000012,
  },
  "llama-4-maverick": {
    mode: "chat",
    input_cost_per_token: 0.0000002,
    output_cost_per_token: 0.0000006,
  },
  "azure/gpt-5": {
    mode: "chat",
    input_cost_per_token: 0.005, // must lose to the bare "gpt-5" key
    output_cost_per_token: 0.005,
  },
  "vertex_ai/gemini-2.5-pro": {
    mode: "chat",
    input_cost_per_token: 0.00000125,
    output_cost_per_token: 0.00001,
  },
  "corrupt-gpt-model": {
    mode: "chat",
    input_cost_per_token: 5, // $5 per token — rejected as corrupt
    output_cost_per_token: 0.00001,
  },
};

describe("buildPricingTableFromLiteLLM", () => {
  it("converts per-token prices to USD per million tokens", () => {
    const table = buildPricingTableFromLiteLLM(FEED, UPDATED_AT);
    expect(table?.models["gpt-5"]).toEqual({ input: 1.25, output: 10, cacheCreation: 0, cacheRead: 0.125 });
    expect(table?.models["claude-sonnet-4-6"]).toEqual({ input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 });
  });

  it("includes chat and responses modes only", () => {
    const table = buildPricingTableFromLiteLLM(FEED, UPDATED_AT);
    expect(table?.models["gpt-5-codex"]).toBeDefined();
    expect(table?.models["gpt-4o-mini-tts"]).toBeUndefined();
  });

  it("filters out model families coding agents never report", () => {
    const table = buildPricingTableFromLiteLLM(FEED, UPDATED_AT);
    expect(table?.models["llama-4-maverick"]).toBeUndefined();
    expect(table?.models.sample_spec).toBeUndefined();
  });

  it("prefers bare model IDs over provider-prefixed duplicates", () => {
    const table = buildPricingTableFromLiteLLM(FEED, UPDATED_AT);
    expect(table?.models["gpt-5"]?.input).toBe(1.25);
  });

  it("keeps provider-prefixed models that have no bare entry, under the bare ID", () => {
    const table = buildPricingTableFromLiteLLM(FEED, UPDATED_AT);
    expect(table?.models["gemini-2.5-pro"]).toEqual({ input: 1.25, output: 10, cacheCreation: 0, cacheRead: 0 });
  });

  it("drops entries with corrupt prices", () => {
    const table = buildPricingTableFromLiteLLM(FEED, UPDATED_AT);
    expect(table?.models["corrupt-gpt-model"]).toBeUndefined();
  });

  it("produces a version hash that is stable across key order", () => {
    const reversed = Object.fromEntries(Object.entries(FEED).reverse());
    const a = buildPricingTableFromLiteLLM(FEED, UPDATED_AT);
    const b = buildPricingTableFromLiteLLM(reversed, UPDATED_AT);
    expect(a?.version).toBe(b?.version);
    expect(a?.version).toMatch(/^\d+-[0-9a-f]{8}$/);
  });

  it("changes the version hash when a price changes", () => {
    const changed = {
      ...FEED,
      "gpt-5": { ...FEED["gpt-5"], output_cost_per_token: 0.00002 },
    };
    const a = buildPricingTableFromLiteLLM(FEED, UPDATED_AT);
    const b = buildPricingTableFromLiteLLM(changed, UPDATED_AT);
    expect(a?.version).not.toBe(b?.version);
  });

  it("returns null for inputs that are not the feed at all", () => {
    expect(buildPricingTableFromLiteLLM(null, UPDATED_AT)).toBeNull();
    expect(buildPricingTableFromLiteLLM([], UPDATED_AT)).toBeNull();
    expect(buildPricingTableFromLiteLLM({ only: { mode: "embedding" } }, UPDATED_AT)).toBeNull();
  });
});
