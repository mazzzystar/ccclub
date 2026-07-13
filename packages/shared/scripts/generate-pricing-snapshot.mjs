#!/usr/bin/env node
// Regenerates src/pricing-snapshot.ts from the LiteLLM price feed.
//
// Usage:
//   node scripts/generate-pricing-snapshot.mjs [path-to-litellm.json]
//
// With no argument the feed is fetched from the network. Requires a prior
// `tsc` build (imports the compiled transform so the snapshot and the Worker
// cron share exactly one implementation). `pnpm update-snapshot` does both.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPricingTableFromLiteLLM, LITELLM_PRICING_URL } from "../dist/litellm.js";

const OUTPUT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "pricing-snapshot.ts");

async function loadRawFeed() {
  const localPath = process.argv[2];
  if (localPath) {
    return JSON.parse(await readFile(localPath, "utf-8"));
  }
  const res = await fetch(LITELLM_PRICING_URL, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`LiteLLM feed returned HTTP ${res.status}`);
  return res.json();
}

const table = buildPricingTableFromLiteLLM(await loadRawFeed(), new Date().toISOString());
if (table == null || Object.keys(table.models).length < 50) {
  throw new Error(`refusing to write snapshot: got ${table ? Object.keys(table.models).length : 0} models`);
}
table.source = "snapshot";

const contents = `// AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
// Regenerate with: pnpm --filter @ccclub/shared update-snapshot
// Source: LiteLLM model_prices_and_context_window.json (${table.updatedAt})
import type { PricingTable } from "./pricing.js";

export const PRICING_SNAPSHOT: PricingTable = ${JSON.stringify(table, null, 2)};
`;

await writeFile(OUTPUT_PATH, contents);
console.log(`wrote ${Object.keys(table.models).length} models (version ${table.version}) to ${OUTPUT_PATH}`);
