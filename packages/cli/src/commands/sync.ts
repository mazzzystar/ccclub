import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import ora from "ora";
import { requireConfig, loadConfig, getLastSyncPath, getLastSyncTimePath } from "../config.js";
import type { CliConfig } from "../config.js";
import { collectUsageEntries } from "../collector.js";
import { getEffectiveSources, resolveCollectSources } from "../sources/index.js";
import type { SourceCollection } from "../sources/index.js";
import { aggregateToBlocks } from "../aggregator.js";
import { loadPricing, refreshPricingCache } from "../pricing.js";
import { refreshRankCache } from "../statusline.js";
import { createScanCacheFactory } from "../scan-cache.js";
import { AGENT_LABELS, AGENT_SOURCES, CCCLUB_CONFIG_DIR } from "@ccclub/shared";
import type { AgentSource, SyncRequest, SyncResponse, UsageBlock } from "@ccclub/shared";
import { formatFetchError } from "../fetch-error.js";
import { fetchUsageLimits } from "../usage-limits.js";
import { acquireSyncLock } from "../sync-lock.js";
import { installHook, isHookInstalled, newerPinnedHookVersion } from "../hook.js";
import { installHeartbeat, isHeartbeatInstalled, newerPinnedHeartbeatVersion } from "../heartbeat.js";
import { pinNotice } from "../pin-version.js";
import { getCurrentVersion } from "../version.js";
import { maybeAutoEnableStatusline } from "../statusline-install.js";

// Bump this when the block format or accounting semantics change. It forces a
// one-time source replacement so corrected parsing can also delete obsolete
// historical blocks. Newly supported sources do NOT need a bump:
// filterBlocksToSync already uploads their full history.
const SYNC_FORMAT_VERSION = 19;

function getSyncVersionPath(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "sync-version");
}

function getLastSyncBySourcePath(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "last-sync-sources.json");
}

function getSyncedPricingVersionPath(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "synced-pricing-version");
}

export function needsPricingResync(hasSyncedUsage: boolean, storedVersion: string | null, currentVersion: string): boolean {
  return hasSyncedUsage && storedVersion !== currentVersion;
}

export function needsFullSync(): boolean {
  const path = getSyncVersionPath();
  if (!existsSync(path)) return true;
  try {
    return needsSyncFormatUpgrade(readFileSync(path, "utf-8").trim(), SYNC_FORMAT_VERSION);
  } catch { return true; }
}

export function needsSyncFormatUpgrade(stored: string, current: number): boolean {
  const parsed = Number(stored);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return true;
  // A newer client may already have upgraded this machine. Never let an older
  // binary interpret that forward version as a reason to replace history.
  return parsed < current;
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

  const lock = await acquireSyncLock();
  if (lock == null) {
    if (!silent) console.log(chalk.dim("  Sync already running; skipping duplicate."));
    return;
  }

  try {
    // Running a newer CLI once must also pin background entrypoints to that
    // exact package version instead of resolving a globally installed binary.
    // Inside the lock: hook and heartbeat syncs run concurrently, and this is
    // a read-modify-write of ~/.claude/settings.json — unserialized, two
    // writers could drop each other's (or the user's) unrelated changes.
    await Promise.all([
      isHookInstalled() ? Promise.resolve(true) : installHook(),
      isHeartbeatInstalled() ? Promise.resolve(true) : installHeartbeat(),
    ]);

    // Refusing to re-pin is the right call but a silent one: say so once, so
    // an older binary running here does not look like it simply lost.
    if (!silent) {
      const version = getCurrentVersion();
      const notice = pinNotice(newerPinnedHeartbeatVersion(version) ?? newerPinnedHookVersion(version), version);
      if (notice) console.log(chalk.dim(`  ${notice}`));
    }

    // Statusline setup converges here too. Its original enable had exactly
    // one shot — first init/join, and only if `npm install -g` succeeded that
    // day — so a machine that missed it stayed without a statusline forever.
    // The throttle keeps the `npm list -g` probe to once a day; every other
    // outcome short-circuits on local file reads.
    await maybeAutoEnableStatusline({ retryThrottleMs: 24 * 60 * 60 * 1000 });

    await performSync(config, firstSync, silent);
  } finally {
    await lock.release();
  }
}

async function performSync(config: CliConfig, firstSync = false, silent = false): Promise<void> {
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
  // and never affects it. Opt-in sources the user enabled belong in here too,
  // or the server's merge semantics would see this machine as no longer
  // tracking a source it is actively uploading.
  const trackedSources = getEffectiveSources(config);
  const collectSources = resolveCollectSources(config);

  try {
    const { calculateCost, version } = await loadPricing();
    const lastSyncPath = getLastSyncPath();
    const pricingVersionPath = getSyncedPricingVersionPath();
    let syncedPricingVersion: string | null = null;
    try {
      syncedPricingVersion = (await readFile(pricingVersionPath, "utf-8")).trim() || null;
    } catch {
      // Existing users do one full, cached-token reprice after this upgrade.
    }
    if (needsPricingResync(existsSync(lastSyncPath), syncedPricingVersion, version)) {
      firstSync = true;
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

    const [{ entries, humanTurns, sources, warnings }, usageSnapshot] = await Promise.all([
      collectUsageEntries({
        sources: collectSources,
        calculateCost,
        openScanCache: createScanCacheFactory(),
        // API-backed sources narrow their query to what is new. A full sync
        // withholds the watermarks so they refetch everything — which is also
        // what makes clearing a source's marker a working repair.
        lastSyncBySource: firstSync ? undefined : lastSyncBySource,
      }),
      fetchUsageLimits().catch(() => null),
    ]);
    const populatedSources = sources.filter((source) => source.entries.length > 0);
    const replaceSources = firstSync
      ? sources.filter((source) => source.files > 0).map((source) => source.source)
      : [];
    const activeSources = populatedSources.map((source) => AGENT_LABELS[source.source]);
    if (spinner) spinner.text = `Found ${entries.length} entries${activeSources.length > 0 ? ` from ${activeSources.join(", ")}` : ""}`;

    if (entries.length === 0 && replaceSources.length === 0) {
      if (spinner) spinner.warn("No usage data found for supported coding agents");
      if (!silent && warnings.length > 0) {
        for (const warning of warnings) log(chalk.dim(`  ${warning}`));
      }
      return;
    }

    const allBlocks = aggregateToBlocks(entries, humanTurns);

    // Filter to blocks since last sync
    let lastSync: string | null = null;
    if (existsSync(lastSyncPath)) {
      lastSync = (await readFile(lastSyncPath, "utf-8")).trim() || null;
    }

    const blocksToSync = filterBlocksToSync(allBlocks, { lastSync, lastSyncBySource, hasSourceState, firstSync });
    const nextLastSyncBySource = { ...lastSyncBySource };
    for (const source of replaceSources) delete nextLastSyncBySource[source];
    advanceSourceWatermarks(nextLastSyncBySource, allBlocks, sources);

    if (blocksToSync.length === 0 && replaceSources.length === 0) {
      if (spinner) spinner.succeed("Already up to date");
      // Merge instead of overwrite: a CCCLUB_SOURCES-filtered run must not
      // erase the sync markers of sources it did not collect.
      await writeFile(getLastSyncBySourcePath(), JSON.stringify(nextLastSyncBySource, null, 2));
      await writeFile(getSyncVersionPath(), String(SYNC_FORMAT_VERSION));
      await writeFile(pricingVersionPath, version);
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

    const syncBody: SyncRequest = {
      blocks: blocksToSync,
      trackedSources,
      syncFormatVersion: SYNC_FORMAT_VERSION,
    };
    // A parser correction can make an old block disappear completely. Merging
    // by block key cannot delete that stale block, so full syncs replace every
    // source for which local log files were successfully scanned, even when
    // the corrected source now has zero billable entries.
    if (replaceSources.length > 0) syncBody.replaceSources = replaceSources;
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
    const latest = blocksToSync.at(-1);
    if (latest != null) await writeFile(lastSyncPath, latest.blockStart);
    await writeFile(getLastSyncBySourcePath(), JSON.stringify(nextLastSyncBySource, null, 2));
    await writeFile(getSyncVersionPath(), String(SYNC_FORMAT_VERSION));
    await writeFile(pricingVersionPath, version);
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

/**
 * Move each source's watermark up to its newest block — except for a source
 * whose collector only got through part of its window. filterBlocksToSync
 * never looks below a watermark again, so advancing past a truncated read
 * would strand the blocks that read never reached, permanently. Holding the
 * marker makes the next run ask for the same window; blocks key on
 * source+blockStart and Cursor events on request id, so the repeat is free.
 *
 * A truncated run with NO previous marker (first sync, or a repaired one) has
 * nothing to hold: it advances anyway, or every later sync replays the same
 * fifty pages forever without ever reaching further back.
 * Exported for tests.
 */
export function advanceSourceWatermarks(
  markers: Partial<Record<AgentSource, string>>,
  allBlocks: UsageBlock[],
  collections: Array<Pick<SourceCollection, "source" | "truncated">>,
): Partial<Record<AgentSource, string>> {
  const truncated = new Set(
    collections.filter((collection) => collection.truncated).map((collection) => collection.source),
  );
  for (const [source, blockStart] of Object.entries(getLatestBlockStartBySource(allBlocks)) as Array<[AgentSource, string]>) {
    if (truncated.has(source) && markers[source] != null) continue;
    markers[source] = blockStart;
  }
  return markers;
}
