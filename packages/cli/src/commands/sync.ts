import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import ora from "ora";
import { requireConfig, getLastSyncPath } from "../config.js";
import { collectUsageEntries } from "../collector.js";
import { aggregateToBlocks } from "../aggregator.js";
import { CCCLUB_CONFIG_DIR } from "@ccclub/shared";
import type { SyncResponse, UsageBlock } from "@ccclub/shared";

// Bump this when block format changes to auto-trigger full re-sync
const SYNC_FORMAT_VERSION = "3";

function getSyncVersionPath(): string {
  return join(homedir(), CCCLUB_CONFIG_DIR, "sync-version");
}

function needsFullSync(): boolean {
  const path = getSyncVersionPath();
  if (!existsSync(path)) return true;
  try {
    const stored = require("node:fs").readFileSync(path, "utf-8").trim();
    return stored !== SYNC_FORMAT_VERSION;
  } catch { return true; }
}

export async function syncCommand(options: { silent?: boolean; full?: boolean }): Promise<void> {
  await doSync(options.full || false, options.silent);
}

export async function doSync(firstSync = false, silent = false): Promise<void> {
  const config = await requireConfig();

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

    const res = await fetch(`${config.apiUrl}/api/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({ blocks: blocksToSync }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      if (spinner) spinner.fail(`Sync failed: ${(err as { error: string }).error}`);
      return;
    }

    const data = (await res.json()) as SyncResponse;

    // Save last sync timestamp and format version
    const latest = blocksToSync[blocksToSync.length - 1];
    await writeFile(lastSyncPath, latest.blockStart);
    await writeFile(getSyncVersionPath(), SYNC_FORMAT_VERSION);

    const totalTokens = blocksToSync.reduce((s, b) => s + b.totalTokens, 0);
    const totalCost = blocksToSync.reduce((s, b) => s + b.costUSD, 0);

    if (spinner) {
      spinner.succeed(`Synced ${data.synced} blocks`);
      log(chalk.dim(`  Tokens: ${totalTokens.toLocaleString()}  Cost: $${totalCost.toFixed(4)}`));
    }
  } catch (err) {
    if (spinner) spinner.fail(`Sync error: ${err instanceof Error ? err.message : err}`);
  }
}
