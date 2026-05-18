import { join } from "node:path";
import { homedir } from "node:os";
import {
  AMP_DATA_DIR_ENV,
  DEFAULT_AMP_DIR,
  calculateCost,
} from "@ccclub/shared";
import type { UsageEntry } from "@ccclub/shared";
import type { AgentSourceCollector, SourceCollection, UsageTurn } from "./types.js";
import {
  asNumber,
  asRecord,
  asString,
  existingDirectories,
  globFiles,
  parsePathList,
  readJsonFile,
  toIsoTimestamp,
} from "./shared.js";

function getAmpDirs(): Promise<string[]> {
  const dirs = parsePathList(process.env[AMP_DATA_DIR_ENV], [join(homedir(), DEFAULT_AMP_DIR)]);
  return existingDirectories(dirs);
}

function getAmpCacheTokens(messages: unknown, toMessageId: number): {
  cacheCreationTokens: number;
  cacheReadTokens: number;
} {
  if (!Array.isArray(messages)) return { cacheCreationTokens: 0, cacheReadTokens: 0 };
  for (const message of messages) {
    const record = asRecord(message);
    if (record?.role !== "assistant" || asNumber(record.messageId) !== toMessageId) continue;
    const usage = asRecord(record.usage);
    return {
      cacheCreationTokens: asNumber(usage?.cacheCreationInputTokens),
      cacheReadTokens: asNumber(usage?.cacheReadInputTokens),
    };
  }
  return { cacheCreationTokens: 0, cacheReadTokens: 0 };
}

function parseAmpThread(data: unknown): UsageEntry[] {
  const source = "amp";
  const thread = asRecord(data);
  const threadId = asString(thread?.id) ?? "unknown";
  const usageLedger = asRecord(thread?.usageLedger);
  const events = usageLedger?.events;
  if (!Array.isArray(events)) return [];

  const entries: UsageEntry[] = [];
  for (const rawEvent of events) {
    const event = asRecord(rawEvent);
    if (event == null) continue;
    const timestamp = toIsoTimestamp(event.timestamp);
    const model = asString(event.model);
    const tokens = asRecord(event.tokens);
    if (timestamp == null || model == null || tokens == null) continue;

    const inputTokens = asNumber(tokens.input);
    const outputTokens = asNumber(tokens.output);
    const toMessageId = asNumber(event.toMessageId);
    const { cacheCreationTokens, cacheReadTokens } = getAmpCacheTokens(thread?.messages, toMessageId);
    if (inputTokens === 0 && outputTokens === 0 && cacheCreationTokens === 0 && cacheReadTokens === 0) {
      continue;
    }

    const requestId = [
      source,
      threadId,
      timestamp,
      model,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      toMessageId,
    ].join(":");

    entries.push({
      source,
      timestamp,
      sessionId: threadId,
      requestId,
      model,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      totalTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
      costUSD: calculateCost(model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens),
    });
  }

  return entries;
}

export async function collectAmpUsage(): Promise<SourceCollection> {
  const source = "amp";
  const dirs = await getAmpDirs();
  const files = await globFiles(dirs.map((dir) => join(dir, "threads")), "**/*.json");
  const entries: UsageEntry[] = [];
  const turns: UsageTurn[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    for (const entry of parseAmpThread(await readJsonFile(file))) {
      const key = entry.requestId ?? `${source}:${entry.sessionId}:${entry.timestamp}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
      turns.push({ source, timestamp: entry.timestamp, key });
    }
  }

  return { source, entries, turns, files: files.length, warnings: [] };
}

export const ampCollector: AgentSourceCollector = {
  source: "amp",
  label: "Amp",
  collect: collectAmpUsage,
};
