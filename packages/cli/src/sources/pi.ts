import { basename, join } from "node:path";
import { homedir } from "node:os";
import {
  DEFAULT_PI_AGENT_SESSIONS_DIR,
  PI_AGENT_DIR_ENV,
} from "@ccclub/shared";
import type { UsageEntry } from "@ccclub/shared";
import type { AgentSourceCollector, CollectorContext, SourceCollection, UsageFact, UsageTurn } from "./types.js";
import { priceUsageFact } from "./types.js";
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

function getPiSessionDirs(): Promise<string[]> {
  const dirs = parsePathList(process.env[PI_AGENT_DIR_ENV], [join(homedir(), DEFAULT_PI_AGENT_SESSIONS_DIR)]);
  return existingDirectories(dirs);
}

function extractSessionId(file: string): string {
  const name = basename(file, ".jsonl");
  const index = name.indexOf("_");
  return index === -1 ? name : name.slice(index + 1);
}

function extractProject(file: string): string {
  const parts = file.split(/[\\/]/g);
  const sessionsIndex = parts.findIndex((part) => part === "sessions");
  return sessionsIndex >= 0 ? (parts[sessionsIndex + 1] ?? "unknown") : "unknown";
}

function normalizePiModel(model: string | undefined): string {
  return model == null ? "unknown" : `[pi] ${model}`;
}

const PI_SCAN_VERSION = 1;

async function scanPiFile(file: string): Promise<UsageFact[]> {
  const source = "pi";
  const sessionId = extractSessionId(file);
  const project = extractProject(file);
  const entries: UsageFact[] = [];

  await readJsonlFile(file, (value) => {
    const record = asRecord(value);
    const message = asRecord(record?.message);
    const usage = asRecord(message?.usage);
    const timestamp = toIsoTimestamp(record?.timestamp);
    if (timestamp == null || usage == null || message?.role !== "assistant") return;

    const inputTokens = asNumber(usage.input);
    const outputTokens = asNumber(usage.output);
    const cacheReadTokens = asNumber(usage.cacheRead);
    const cacheCreationTokens = asNumber(usage.cacheWrite);
    if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheCreationTokens === 0) {
      return;
    }

    const cost = asRecord(usage.cost);
    const reportedCostUSD = asNumber(cost?.total);
    const model = normalizePiModel(asString(message.model));
    const totalTokens = asNumber(usage.totalTokens) ||
      inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
    const key = [
      source,
      project,
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
      // pi logs its own cost; older sessions without one fall back to table pricing.
      ...(reportedCostUSD > 0 ? { reportedCostUSD } : {}),
    });
  });

  return entries;
}

export async function collectPiUsage(context: CollectorContext): Promise<SourceCollection> {
  const source = "pi";
  const dirs = await getPiSessionDirs();
  const files = await globFiles(dirs, "**/*.jsonl");
  const cache = await context.openScanCache?.<UsageFact[]>(source, `parser=${PI_SCAN_VERSION}`);
  const entries: UsageEntry[] = [];
  const turns: UsageTurn[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const stat = await statFile(file);
    let parsed = stat != null ? cache?.get(file, stat) : undefined;
    if (parsed == null) {
      parsed = await scanPiFile(file);
      if (stat != null) cache?.set(file, stat, parsed);
    }

    // Dedup spans files: replayed session copies share the same content key.
    for (const fact of parsed) {
      const entry = priceUsageFact(fact, context);
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

export const piCollector: AgentSourceCollector = {
  source: "pi",
  label: "pi-agent",
  collect: collectPiUsage,
};
