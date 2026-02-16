import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import ora from "ora";
import { requireConfig, loadConfig, getLastSyncPath, getLastSyncTimePath } from "../config.js";
import { collectUsageEntries } from "../collector.js";
import { aggregateToBlocks } from "../aggregator.js";
import { CCCLUB_CONFIG_DIR } from "@ccclub/shared";
import type { SyncResponse, UsageBlock } from "@ccclub/shared";

// Bump this when block format changes to auto-trigger full re-sync
const SYNC_FORMAT_VERSION = "6";

function getSyncVersionPath(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "sync-version");
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

  // Auto full-sync when block format version changes (e.g. chatCount added)
  if (!firstSync && needsFullSync()) {
    firstSync = true;
  }

  const log = silent ? () => {} : console.log;
  const spinner = silent ? null : ora("Collecting usage data...").start();

  try {
    const { entries, humanTurns } = await collectUsageEntries();
    if (spinner) spinner.text = `Found ${entries.length} entries`;

    if (entries.length === 0) {
      if (spinner) spinner.warn("No usage data found in ~/.claude/projects/");
      return;
    }

    const allBlocks = aggregateToBlocks(entries, humanTurns);

    // Filter to blocks since last sync
    const lastSyncPath = getLastSyncPath();
    let lastSync: string | null = null;
    if (existsSync(lastSyncPath)) {
      lastSync = (await readFile(lastSyncPath, "utf-8")).trim() || null;
    }

    let blocksToSync: UsageBlock[];
    if (lastSync && !firstSync) {
      const lastSyncTime = new Date(lastSync).getTime();
      blocksToSync = allBlocks.filter((b) => new Date(b.blockStart).getTime() >= lastSyncTime);
    } else {
      blocksToSync = allBlocks;
    }

    if (blocksToSync.length === 0) {
      if (spinner) spinner.succeed("Already up to date");
      // Still write sync version even if no new blocks
      await writeFile(getSyncVersionPath(), SYNC_FORMAT_VERSION);
      return;
    }

    if (spinner) spinner.text = `Uploading ${blocksToSync.length} blocks...`;

    // Upload in batches of 400 to stay within server limit (500)
    const BATCH_SIZE = 400;
    let totalSynced = 0;
    for (let i = 0; i < blocksToSync.length; i += BATCH_SIZE) {
      const batch = blocksToSync.slice(i, i + BATCH_SIZE);
      if (spinner && blocksToSync.length > BATCH_SIZE) {
        spinner.text = `Uploading blocks ${i + 1}–${i + batch.length} of ${blocksToSync.length}...`;
      }
      const res = await fetch(`${config.apiUrl}/api/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({ blocks: batch }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: res.statusText }));
        if (spinner) spinner.fail(`Sync failed: ${(errBody as { error: string }).error}`);
        if (silent) throw new Error(`sync failed: ${res.status}`);
        return;
      }
      const batchData = (await res.json()) as SyncResponse;
      totalSynced += batchData.synced;
    }

    const data = { synced: totalSynced } as SyncResponse;

    // Save last sync timestamp and format version
    const latest = blocksToSync[blocksToSync.length - 1];
    await writeFile(lastSyncPath, latest.blockStart);
    await writeFile(getSyncVersionPath(), SYNC_FORMAT_VERSION);
    await writeFile(getLastSyncTimePath(), String(Date.now()));

    const totalTokens = blocksToSync.reduce((s, b) => s + b.totalTokens, 0);
    const totalCost = blocksToSync.reduce((s, b) => s + b.costUSD, 0);

    if (spinner) {
      spinner.succeed(`Synced ${data.synced} blocks`);
      log(chalk.dim(`  Tokens: ${totalTokens.toLocaleString()}  Cost: $${totalCost.toFixed(4)}`));
    }
  } catch (err) {
    if (spinner) spinner.fail(`Sync error: ${err instanceof Error ? err.message : err}`);
    if (silent) throw err; // Re-throw so hook caller can reset throttle
  }
}
