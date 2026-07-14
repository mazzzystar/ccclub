import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import ora from "ora";
import { requireConfig, loadConfig, getLastSyncPath, getLastSyncTimePath } from "../config.js";
import { collectUsageEntries } from "../collector.js";
import { parseSources } from "../sources/index.js";
import { aggregateToBlocks } from "../aggregator.js";
import { loadPricing, refreshPricingCache } from "../pricing.js";
import { refreshRankCache } from "../statusline.js";
import { createScanCacheFactory } from "../scan-cache.js";
import { AGENT_LABELS, AGENT_SOURCES, CCCLUB_CONFIG_DIR, DEFAULT_SOURCES } from "@ccclub/shared";
import type { AgentSource, SyncRequest, SyncResponse, UsageBlock } from "@ccclub/shared";
import { formatFetchError } from "../fetch-error.js";
import { fetchUsageLimits } from "../usage-limits.js";

// Bump this only when the BLOCK FORMAT changes (new fields, different
// aggregation) — it forces a one-time full re-sync for every user, which also
// reprices history against the current table. Newly supported sources do NOT
// need a bump: filterBlocksToSync uploads the full history of any source that
// has no per-source sync marker yet.
const SYNC_FORMAT_VERSION = "13";

function getSyncVersionPath(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "sync-version");
}

function getLastSyncBySourcePath(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "last-sync-sources.json");
}

export function needsFullSync(): boolean {
  const path = getSyncVersionPath();
  if (!existsSync(path)) return true;
  try {
    const stored = readFileSync(path, "utf-8").trim();
    return stored !== SYNC_FORMAT_VERSION;
  } catch { return true; }
}

// Throttle interval for silent (hook-triggered) syncs: 5 minutes
const THROTTLE_MS = 5 * 60 * 1000;

export async function syncCommand(options: { silent?: boolean; full?: boolean }): Promise<void> {
  // When called silently (from hook), skip if last sync was < 5 minutes ago
  const timePath = getLastSyncTimePath();
  if (options.silent && !options.full) {
    if (existsSync(timePath)) {
      try {
        const ts = parseInt(readFileSync(timePath, "utf-8").trim(), 10);
        if (Date.now() - ts < THROTTLE_MS) return;
      } catch { /* proceed with sync */ }
    }
    // Write timestamp NOW to prevent concurrent hook invocations from also syncing
    try { writeFileSync(timePath, String(Date.now())); } catch { /* dir may not exist yet */ }
  }

  try {
    await doSync(options.full || false, options.silent);
  } catch {
    // If sync failed, clear throttle so next Stop event retries sooner
    if (options.silent) {
      try { writeFileSync(timePath, "0"); } catch { /* ignore */ }
    }
  }
}

export async function doSync(firstSync = false, silent = false): Promise<void> {
  const config = silent ? await loadConfig() : await requireConfig();
  if (!config) return; // Not initialized — nothing to sync

  // Refresh the pricing cache in the background (no-op if under 24h old).
  // Cost calculation below uses the table already on disk; a fresh table
  // takes effect on the next sync. refreshPricingCache never throws.
  const pricingRefresh = refreshPricingCache(config.apiUrl);

  // Auto full-sync when block format version changes (e.g. chatCount added)
  if (!firstSync && needsFullSync()) {
    firstSync = true;
  }

  const log = silent ? () => {} : console.log;
  const spinner = silent ? null : ora("Collecting usage data...").start();

  // Reporting trackedSources lets the server prune non-coding sources that
  // 0.6.0/0.6.1 uploaded; CCCLUB_SOURCES stays a per-run collection filter
  // and never affects it.
  const trackedSources = [...DEFAULT_SOURCES];
  const collectSources = process.env.CCCLUB_SOURCES?.trim()
    ? parseSources(process.env.CCCLUB_SOURCES)
    : trackedSources;

  try {
    const { calculateCost, version } = await loadPricing();
    const [{ entries, humanTurns, sources, warnings }, usageSnapshot] = await Promise.all([
      collectUsageEntries({
        sources: collectSources,
        calculateCost,
        pricingVersion: version,
        openScanCache: createScanCacheFactory(),
      }),
      fetchUsageLimits().catch(() => null),
    ]);
    const populatedSources = sources.filter((source) => source.entries.length > 0);
    const activeSources = populatedSources.map((source) => AGENT_LABELS[source.source]);
    if (spinner) spinner.text = `Found ${entries.length} entries${activeSources.length > 0 ? ` from ${activeSources.join(", ")}` : ""}`;

    if (entries.length === 0) {
      if (spinner) spinner.warn("No usage data found for supported coding agents");
      if (!silent && warnings.length > 0) {
        for (const warning of warnings) log(chalk.dim(`  ${warning}`));
      }
      return;
    }

    const allBlocks = aggregateToBlocks(entries, humanTurns);

    // Filter to blocks since last sync
    const lastSyncPath = getLastSyncPath();
    let lastSync: string | null = null;
    if (existsSync(lastSyncPath)) {
      lastSync = (await readFile(lastSyncPath, "utf-8")).trim() || null;
    }

    let lastSyncBySource: Partial<Record<AgentSource, string>> = {};
    const hasSourceState = existsSync(getLastSyncBySourcePath());
    if (hasSourceState) {
      try {
        lastSyncBySource = JSON.parse(await readFile(getLastSyncBySourcePath(), "utf-8")) as Partial<Record<AgentSource, string>>;
      } catch {
        lastSyncBySource = {};
      }
    }

    const blocksToSync = filterBlocksToSync(allBlocks, { lastSync, lastSyncBySource, hasSourceState, firstSync });

    if (blocksToSync.length === 0) {
      if (spinner) spinner.succeed("Already up to date");
      // Merge instead of overwrite: a CCCLUB_SOURCES-filtered run must not
      // erase the sync markers of sources it did not collect.
      await writeFile(getLastSyncBySourcePath(), JSON.stringify({ ...lastSyncBySource, ...getLatestBlockStartBySource(allBlocks) }, null, 2));
      await writeFile(getSyncVersionPath(), SYNC_FORMAT_VERSION);
      // Even with no new blocks, upload usage snapshot so others see fresh data
      if (usageSnapshot) {
        fetch(`${config.apiUrl}/api/usage`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
          body: JSON.stringify({ usageSnapshot }),
          signal: AbortSignal.timeout(8_000),
        }).catch(() => {});
      }
      await refreshRankCache(config);
      return;
    }

    if (spinner) spinner.text = `Uploading ${blocksToSync.length} blocks...`;

    const syncBody: SyncRequest = { blocks: blocksToSync, trackedSources };
    // A parser correction can make an old block disappear completely. Merging
    // by block key cannot delete that stale block, so full syncs replace the
    // complete history of sources for which this scan actually found data.
    if (firstSync) syncBody.replaceSources = populatedSources.map((source) => source.source);
    if (usageSnapshot) syncBody.usageSnapshot = usageSnapshot;

    const res = await fetch(`${config.apiUrl}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(syncBody),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: res.statusText }));
      if (spinner) spinner.fail(`Sync failed: ${(errBody as { error: string }).error}`);
      if (silent) throw new Error(`sync failed: ${res.status}`);
      return;
    }

    const data = (await res.json()) as SyncResponse;

    // Save last sync timestamp and format version
    const latest = blocksToSync[blocksToSync.length - 1];
    await writeFile(lastSyncPath, latest.blockStart);
    await writeFile(getLastSyncBySourcePath(), JSON.stringify({ ...lastSyncBySource, ...getLatestBlockStartBySource(allBlocks) }, null, 2));
    await writeFile(getSyncVersionPath(), SYNC_FORMAT_VERSION);
    await writeFile(getLastSyncTimePath(), String(Date.now()));

    // The upload just changed today's numbers — refresh the statusline cache.
    await refreshRankCache(config);

    const totalTokens = blocksToSync.reduce((s, b) => s + b.totalTokens, 0);
    const totalCost = blocksToSync.reduce((s, b) => s + b.costUSD, 0);

    if (spinner) {
      spinner.succeed(`Synced ${data.synced} blocks`);
      log(chalk.dim(`  Tokens: ${totalTokens.toLocaleString()}  Cost: $${totalCost.toFixed(4)}`));
      if (warnings.length > 0) {
        for (const warning of warnings) log(chalk.dim(`  ${warning}`));
      }
    }
  } catch (err) {
    if (spinner) spinner.fail(`Sync error: ${formatFetchError(err)}`);
    if (silent) throw err; // Re-throw so hook caller can reset throttle
  } finally {
    await pricingRefresh;
  }
}

/**
 * Which blocks to upload. Incremental per source; a source with no sync
 * marker yet (newly supported by the CLI, or a tool the user just started
 * using) uploads its FULL history — falling back to the global cutoff would
 * silently skip everything older than the user's latest activity.
 * Exported for tests.
 */
export function filterBlocksToSync(
  allBlocks: UsageBlock[],
  state: {
    lastSync: string | null;
    lastSyncBySource: Partial<Record<AgentSource, string>>;
    hasSourceState: boolean;
    firstSync: boolean;
  },
): UsageBlock[] {
  if (!state.lastSync || state.firstSync) return allBlocks;
  const globalCutoff = new Date(state.lastSync).getTime();

  return allBlocks.filter((block) => {
    const source = block.source ?? "claude";
    const sourceLastSync = state.lastSyncBySource[source];
    if (sourceLastSync == null) {
      // Pre-source-tracking installs have no marker file at all; keep the old
      // global-cutoff behavior for them instead of a surprise full upload.
      return state.hasSourceState ? true : new Date(block.blockStart).getTime() >= globalCutoff;
    }
    return new Date(block.blockStart).getTime() >= new Date(sourceLastSync).getTime();
  });
}

function getLatestBlockStartBySource(blocks: UsageBlock[]): Partial<Record<AgentSource, string>> {
  const latest: Partial<Record<AgentSource, string>> = {};
  for (const block of blocks) {
    const source = block.source ?? "claude";
    if (!AGENT_SOURCES.includes(source)) continue;
    if (latest[source] == null || block.blockStart > latest[source]) {
      latest[source] = block.blockStart;
    }
  }
  return latest;
}
