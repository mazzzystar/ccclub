import { basename, join, sep } from "node:path";
import { homedir } from "node:os";
import {
  DEFAULT_OPENCLAW_DIR,
  OPENCLAW_DATA_DIR_ENV,
} from "@ccclub/shared";
import type { UsageEntry } from "@ccclub/shared";
import type { AgentSourceCollector, CollectorContext, SourceCollection, UsageTurn } from "./types.js";
import {
  asNumber,
  asRecord,
  asString,
  existingDirectories,
  globFiles,
  parsePathList,
  readJsonlFile,
  statFile,
  toIsoTimestamp,
} from "./shared.js";

// OpenClaw's agent runtime derives from pi-mono, so its session logs are a
// superset of the pi format: `message` records with per-response usage and a
// provider-reported cost. Sessions live under agents/<name>/sessions/.

function getOpenClawDirs(): Promise<string[]> {
  const dirs = parsePathList(process.env[OPENCLAW_DATA_DIR_ENV], [join(homedir(), DEFAULT_OPENCLAW_DIR)]);
  return existingDirectories(dirs);
}

/** agents/<name>/sessions/<uuid>.jsonl → "<name>" */
function extractAgentName(file: string): string {
  const parts = file.split(sep);
  const agentsIndex = parts.lastIndexOf("agents");
  return agentsIndex >= 0 ? (parts[agentsIndex + 1] ?? "unknown") : "unknown";
}

async function scanOpenClawFile(file: string, context: CollectorContext): Promise<UsageEntry[]> {
  const source = "openclaw";
  const sessionId = basename(file, ".jsonl");
  const agent = extractAgentName(file);
  const entries: UsageEntry[] = [];

  await readJsonlFile(file, (value) => {
    const record = asRecord(value);
    if (record?.type !== "message") return;
    const message = asRecord(record.message);
    const usage = asRecord(message?.usage);
    const timestamp = toIsoTimestamp(record.timestamp);
    if (timestamp == null || usage == null || message?.role !== "assistant") return;

    const inputTokens = asNumber(usage.input);
    const outputTokens = asNumber(usage.output);
    const cacheReadTokens = asNumber(usage.cacheRead);
    const cacheCreationTokens = asNumber(usage.cacheWrite);
    if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheCreationTokens === 0) {
      return;
    }

    const cost = asRecord(usage.cost);
    const provider = asString(message.provider);
    const bareModel = asString(message.model) ?? "unknown";
    const model = provider == null ? bareModel : `${provider}/${bareModel}`;
    const totalTokens = asNumber(usage.totalTokens) ||
      inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
    const key = [
      source,
      agent,
      sessionId,
      timestamp,
      model,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      totalTokens,
    ].join(":");

    entries.push({
      source,
      timestamp,
      sessionId,
      requestId: key,
      model,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      totalTokens,
      // OpenClaw logs the provider-reported cost; fall back to table pricing.
      costUSD: asNumber(cost?.total) ||
        context.calculateCost(model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens),
    });
  });

  return entries;
}

export async function collectOpenClawUsage(context: CollectorContext): Promise<SourceCollection> {
  const source = "openclaw";
  const dirs = await getOpenClawDirs();
  const allFiles = await globFiles(dirs, "agents/*/sessions/**/*.jsonl");
  // *.trajectory.jsonl files are trace exports that repeat the same usage in
  // a different schema — reading both would double count.
  const files = allFiles.filter((file) => !file.endsWith(".trajectory.jsonl"));
  const cache = await context.openScanCache?.<UsageEntry[]>(source, context.pricingVersion);
  const entries: UsageEntry[] = [];
  const turns: UsageTurn[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const stat = await statFile(file);
    let parsed = stat != null ? cache?.get(file, stat) : undefined;
    if (parsed == null) {
      parsed = await scanOpenClawFile(file, context);
      if (stat != null) cache?.set(file, stat, parsed);
    }

    // Dedup spans files: replayed session copies share the same content key.
    for (const entry of parsed) {
      const key = entry.requestId ?? "";
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
      turns.push({ source, timestamp: entry.timestamp, key });
    }
  }

  await cache?.save();
  return { source, entries, turns, files: files.length, warnings: [] };
}

export const openClawCollector: AgentSourceCollector = {
  source: "openclaw",
  label: "OpenClaw",
  collect: collectOpenClawUsage,
};
