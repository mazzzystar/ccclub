import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  DEFAULT_GROK_DIR,
  GROK_HOME_ENV,
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

// v2: usage comes from session turn_completed, not trimmed unified.jsonl.
const GROK_SCAN_VERSION = 2;
const FALLBACK_MODEL = "grok-4.6";

interface GrokScanResult {
  facts: UsageFact[];
  turns: UsageTurn[];
}

function getGrokHomes(): Promise<string[]> {
  const dirs = parsePathList(process.env[GROK_HOME_ENV], [join(homedir(), DEFAULT_GROK_DIR)]);
  return existingDirectories(dirs);
}

async function listGrokSessionFiles(homes: string[]): Promise<string[]> {
  const groups = await Promise.all(
    homes.map((home) => globFiles([join(home, "sessions")], "**/updates.jsonl")),
  );
  return groups.flat().sort();
}

function canonicalModel(raw: string | undefined): string {
  if (raw == null) return FALLBACK_MODEL;
  return raw.endsWith("-build") ? raw.slice(0, -"-build".length) || FALLBACK_MODEL : raw;
}

function modelFromUsage(usage: Record<string, unknown>): string {
  const modelUsage = asRecord(usage.modelUsage);
  const key = modelUsage == null ? undefined : Object.keys(modelUsage).sort()[0];
  return canonicalModel(key);
}

async function scanGrokSessionFile(file: string): Promise<GrokScanResult> {
  const source = "grok";
  const sessionId = basename(dirname(file));
  const facts: UsageFact[] = [];
  const turns: UsageTurn[] = [];

  await readJsonlFile(file, (value) => {
    const record = asRecord(value);
    const update = asRecord(asRecord(record?.params)?.update);
    if (asString(update?.sessionUpdate) !== "turn_completed") return;

    const usage = asRecord(update?.usage);
    const timestamp = toIsoTimestamp(record?.timestamp);
    if (usage == null || timestamp == null) return;

    const promptTotal = Math.max(0, asNumber(usage.inputTokens));
    const cached = Math.min(Math.max(0, asNumber(usage.cachedReadTokens)), promptTotal);
    const inputTokens = promptTotal - cached;
    const outputTokens = Math.max(0, asNumber(usage.outputTokens));
    const cacheCreationTokens = Math.max(0, asNumber(usage.cacheCreationTokens));
    const reasoningTokens = Math.max(0, asNumber(usage.reasoningTokens));
    const totalTokens = asNumber(usage.totalTokens) || promptTotal + outputTokens;
    if (totalTokens === 0) return;

    const model = modelFromUsage(usage);
    const requestId = [
      source,
      sessionId,
      timestamp,
      model,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cached,
      totalTokens,
    ].join(":");

    facts.push({
      source,
      timestamp,
      sessionId,
      requestId,
      model,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens: cached,
      reasoningTokens,
      totalTokens,
    });
    turns.push({
      source,
      timestamp,
      key: [source, sessionId, timestamp].join(":"),
    });
  });

  return { facts, turns };
}

export async function collectGrokUsage(context: CollectorContext): Promise<SourceCollection> {
  const source = "grok";
  const files = await listGrokSessionFiles(await getGrokHomes());
  const cache = await context.openScanCache?.<GrokScanResult>(source, `parser=${GROK_SCAN_VERSION}`);
  const entries: UsageEntry[] = [];
  const turns: UsageTurn[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const stat = await statFile(file);
    let parsed = stat != null ? cache?.get(file, stat) : undefined;
    if (parsed == null) {
      parsed = await scanGrokSessionFile(file);
      if (stat != null) cache?.set(file, stat, parsed);
    }

    for (const fact of parsed.facts) {
      const entry = priceUsageFact(fact, context);
      const key = entry.requestId ?? "";
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
    turns.push(...parsed.turns);
  }

  await cache?.save();
  return { source, entries, turns, files: files.length, warnings: [] };
}

export const grokCollector: AgentSourceCollector = {
  source: "grok",
  label: "Grok",
  collect: collectGrokUsage,
};
