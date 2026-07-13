import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  CCCLUB_CONFIG_DIR,
  PRICING_SNAPSHOT,
  createCostCalculator,
  mergePricingTables,
  parsePricingTable,
} from "@ccclub/shared";
import type { CostCalculator, PricingTable } from "@ccclub/shared";

// Stale-while-revalidate: cost calculation always uses the table already on
// disk (or the bundled snapshot); a refreshed table takes effect on the next
// run. Collection speed is therefore never gated on the network.
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

interface StoredPricingCache {
  /** When the server last confirmed this table (fresh body or 304). */
  fetchedAt: string;
  table: PricingTable;
}

export function getPricingCachePath(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "pricing.json");
}

async function readCache(cachePath: string): Promise<StoredPricingCache | null> {
  try {
    const raw = JSON.parse(await readFile(cachePath, "utf-8")) as Record<string, unknown>;
    const table = parsePricingTable(raw.table);
    if (table == null || typeof raw.fetchedAt !== "string") return null;
    return { fetchedAt: raw.fetchedAt, table };
  } catch {
    return null; // Missing or corrupt cache: the bundled snapshot still applies.
  }
}

async function writeCache(cachePath: string, cache: StoredPricingCache): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true });
  // Write-then-rename so concurrent hook syncs never read a torn file.
  const tempPath = `${cachePath}.${process.pid}.tmp`;
  await writeFile(tempPath, JSON.stringify(cache));
  await rename(tempPath, cachePath);
}

/** The bundled snapshot overlaid with the most recently fetched server table. */
export async function loadPricingTable(cachePath = getPricingCachePath()): Promise<PricingTable> {
  const cached = await readCache(cachePath);
  return cached == null ? PRICING_SNAPSHOT : mergePricingTables(PRICING_SNAPSHOT, cached.table);
}

export async function loadCostCalculator(cachePath = getPricingCachePath()): Promise<CostCalculator> {
  return createCostCalculator(await loadPricingTable(cachePath));
}

/**
 * Refresh the local pricing cache from the ccclub server when it is older
 * than 24 hours. Never throws: offline or server errors simply leave the
 * current table in place.
 */
export async function refreshPricingCache(
  apiUrl: string,
  cachePath = getPricingCachePath(),
): Promise<void> {
  try {
    const cached = await readCache(cachePath);
    if (cached != null && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_MAX_AGE_MS) {
      return;
    }

    const headers: Record<string, string> = {};
    if (cached != null) headers["If-None-Match"] = `"${cached.table.version}"`;
    const res = await fetch(`${apiUrl}/api/pricing`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (res.status === 304 && cached != null) {
      await writeCache(cachePath, { ...cached, fetchedAt: new Date().toISOString() });
      return;
    }
    if (!res.ok) return;

    const table = parsePricingTable(await res.json());
    if (table == null) return;
    await writeCache(cachePath, { fetchedAt: new Date().toISOString(), table });
  } catch {
    // Offline, timeout, or unwritable cache — keep the current table.
  }
}
