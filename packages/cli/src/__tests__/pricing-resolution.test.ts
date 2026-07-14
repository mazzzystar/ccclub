import { describe, it, expect } from "vitest";
import {
  DEFAULT_FALLBACK_MODEL,
  FAMILY_RULES,
  PRICING_SNAPSHOT,
  createCostCalculator,
  mergePricingTables,
  normalizeModelId,
  parsePricingTable,
  resolveModelPricing,
} from "@ccclub/shared";
import type { PricingTable } from "@ccclub/shared";

const MTOK = 1_000_000;

describe("normalizeModelId", () => {
  it("lowercases and trims", () => {
    expect(normalizeModelId("  Claude-Sonnet-4-6 ")).toBe("claude-sonnet-4-6");
  });

  it("strips provider prefixes as reported by OpenCode", () => {
    expect(normalizeModelId("openai/gpt-5")).toBe("gpt-5");
    expect(normalizeModelId("openrouter/anthropic/claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("strips the pi-agent marker", () => {
    expect(normalizeModelId("[pi] gpt-5")).toBe("gpt-5");
  });
});

describe("resolveModelPricing", () => {
  it("prefers overrides even when the table disagrees", () => {
    const table: PricingTable = {
      ...PRICING_SNAPSHOT,
      models: { "codex-auto-review": { input: 99, output: 99, cacheCreation: 0, cacheRead: 0 } },
    };
    const resolved = resolveModelPricing("codex-auto-review", table);
    expect(resolved.match).toBe("override");
    expect(resolved.pricing.input).toBe(0);
  });

  it("matches exact model IDs from the table", () => {
    const resolved = resolveModelPricing("claude-sonnet-4-5-20250929", PRICING_SNAPSHOT);
    expect(resolved.match).toBe("exact");
    expect(resolved.pricing).toEqual({
      input: 3,
      output: 15,
      cacheCreation: 3.75,
      cacheCreation1h: 6,
      cacheRead: 0.3,
    });
  });

  it("applies the most specific family stem first", () => {
    // "gpt-5.1-codex-mini-preview" must match gpt-5.1-codex-mini, not gpt-5.1-codex.
    const mini = resolveModelPricing("gpt-5.1-codex-mini-preview", PRICING_SNAPSHOT);
    expect(mini.match).toBe("family");
    expect(mini.pricing).toEqual(PRICING_SNAPSHOT.models["gpt-5.1-codex-mini"]);

    const codex = resolveModelPricing("gpt-5.1-codex-preview", PRICING_SNAPSHOT);
    expect(codex.pricing).toEqual(PRICING_SNAPSHOT.models["gpt-5.1-codex"]);
  });

  it("prices unknown variants of known families", () => {
    const resolved = resolveModelPricing("claude-opus-5-experimental-20990101", PRICING_SNAPSHOT);
    expect(resolved.match).toBe("family");
    expect(resolved.pricing).toEqual(PRICING_SNAPSHOT.models["claude-opus-4-7"]);

    const fable = resolveModelPricing("claude-fable-5-preview", PRICING_SNAPSHOT);
    expect(fable.match).toBe("family");
    expect(fable.pricing).toEqual(PRICING_SNAPSHOT.models["claude-fable-5"]);
  });

  it("falls back to sonnet-tier pricing for completely unknown models", () => {
    const resolved = resolveModelPricing("mystery-model-9000", PRICING_SNAPSHOT);
    expect(resolved.match).toBe("default");
    expect(resolved.pricing).toEqual(PRICING_SNAPSHOT.models[DEFAULT_FALLBACK_MODEL]);
  });

  it("keeps every family representative and the default present in the snapshot", () => {
    for (const rule of FAMILY_RULES) {
      expect(PRICING_SNAPSHOT.models[rule.modelId], `missing snapshot entry for ${rule.modelId}`).toBeDefined();
    }
    expect(PRICING_SNAPSHOT.models[DEFAULT_FALLBACK_MODEL]).toBeDefined();
  });

  it("orders family rules by specificity regardless of declaration order", () => {
    for (let i = 1; i < FAMILY_RULES.length; i++) {
      expect(FAMILY_RULES[i - 1].pattern.length).toBeGreaterThanOrEqual(FAMILY_RULES[i].pattern.length);
    }
  });
});

describe("createCostCalculator", () => {
  it("computes per-million costs across all four token kinds", () => {
    const calculate = createCostCalculator(PRICING_SNAPSHOT);
    // claude-opus-4-7: 5 + 25 + 6.25 + 0.5 per MTok
    expect(calculate("claude-opus-4-7", MTOK, MTOK, MTOK, MTOK)).toBeCloseTo(36.75);
  });

  it("prices reasoning tokens at the output rate", () => {
    const calculate = createCostCalculator(PRICING_SNAPSHOT);
    // gpt-5: output $10/MTok
    expect(calculate("gpt-5", 0, 0, 0, 0, MTOK)).toBeCloseTo(10);
  });

  it("prices the 1h subset at its tier without counting it twice", () => {
    const calculate = createCostCalculator(PRICING_SNAPSHOT);
    // Fable 5: total cache writes are 1 MTok, all at the $20/MTok 1h tier.
    expect(calculate("claude-fable-5", 0, 0, MTOK, 0, 0, MTOK)).toBeCloseTo(20);
  });

  it("clamps malformed 1h counts to the total cache-write count", () => {
    const calculate = createCostCalculator(PRICING_SNAPSHOT);
    expect(calculate("claude-fable-5", 0, 0, MTOK, 0, 0, 2 * MTOK)).toBeCloseTo(20);
  });

  it("uses prices from the given table over the snapshot", () => {
    const table = mergePricingTables(PRICING_SNAPSHOT, {
      version: "test",
      updatedAt: "2026-01-01T00:00:00.000Z",
      source: "litellm",
      models: { "gpt-5": { input: 2, output: 4, cacheCreation: 0, cacheRead: 0 } },
    });
    const calculate = createCostCalculator(table);
    expect(calculate("gpt-5", MTOK, MTOK, 0, 0)).toBeCloseTo(6);
  });
});

describe("parsePricingTable", () => {
  const validTable = {
    version: "1-abc",
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "litellm",
    models: { "gpt-5": { input: 1.25, output: 10, cacheCreation: 0, cacheRead: 0.125 } },
  };

  it("accepts a valid table and lowercases model keys", () => {
    const parsed = parsePricingTable({
      ...validTable,
      models: { "GPT-5": validTable.models["gpt-5"] },
    });
    expect(parsed?.models["gpt-5"]).toEqual(validTable.models["gpt-5"]);
  });

  it("preserves an optional 1h cache-write price, including zero", () => {
    const parsed = parsePricingTable({
      ...validTable,
      models: {
        free: { input: 1, output: 2, cacheCreation: 1.25, cacheCreation1h: 0, cacheRead: 0.1 },
      },
    });
    expect(parsed?.models.free.cacheCreation1h).toBe(0);
  });

  it("rejects malformed envelopes", () => {
    expect(parsePricingTable(null)).toBeNull();
    expect(parsePricingTable("{}")).toBeNull();
    expect(parsePricingTable({ ...validTable, version: "" })).toBeNull();
    expect(parsePricingTable({ ...validTable, models: [] })).toBeNull();
  });

  it("drops entries with absurd or invalid prices and rejects empty results", () => {
    const parsed = parsePricingTable({
      ...validTable,
      models: {
        ok: { input: 1, output: 2, cacheCreation: 0, cacheRead: 0 },
        corrupt: { input: 1_000_000, output: 2, cacheCreation: 0, cacheRead: 0 },
        negative: { input: -1, output: 2, cacheCreation: 0, cacheRead: 0 },
        partial: { input: 1, output: 2 },
      },
    });
    expect(Object.keys(parsed?.models ?? {})).toEqual(["ok"]);

    expect(
      parsePricingTable({
        ...validTable,
        models: { corrupt: { input: Number.NaN, output: 2, cacheCreation: 0, cacheRead: 0 } },
      }),
    ).toBeNull();
  });
});
