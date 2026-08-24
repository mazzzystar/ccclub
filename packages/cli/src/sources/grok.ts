import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_GROK_DIR, GROK_HOME_ENV } from "@ccclub/shared";
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

const GROK_SCAN_VERSION = 2;
const FALLBACK_MODEL = "grok-4.6";
const COST_USD_TICKS_PER_USD = 1e10;

interface GrokScanResult {
  facts: UsageFact[];
  turns: UsageTurn[];
}

function getGrokHomes(): Promise<string[]> {
  const dirs = parsePathList(process.env[GROK_HOME_ENV], [join(homedir(), DEFAULT_GROK_DIR)]);
  return existingDirectories(dirs);
}

async function listGrokSessionFiles(homes: string[]): Promise<string[]> {
  return globFiles(homes.map((home) => join(home, "sessions")), "**/updates.jsonl");
}

function usageRows(usage: Record<string, unknown>): Array<[string, Record<string, unknown>]> {
  const modelUsage = asRecord(usage.modelUsage);
  const rows = Object.entries(modelUsage ?? {}).flatMap(([model, value]) => {
    const record = asRecord(value);
    return record == null ? [] : [[model, record] as [string, Record<string, unknown>]];
  });
  return rows.length > 0 ? rows : [[FALLBACK_MODEL, usage]];
}

function usageFact(
  usage: Record<string, unknown>,
  identity: { sessionId: string; timestamp: string; promptId: string; eventId?: string; model: string },
): UsageFact | null {
  const rawInput = Math.max(0, asNumber(usage.inputTokens));
  const cacheReadTokens = Math.min(rawInput, Math.max(0, asNumber(usage.cachedReadTokens)));
  const remainingInput = rawInput - cacheReadTokens;
  const cacheCreationTokens = Math.min(remainingInput, Math.max(0, asNumber(usage.cacheCreationTokens)));
  const inputTokens = remainingInput - cacheCreationTokens;
  const outputTokens = Math.max(0, asNumber(usage.outputTokens));
  const reasoningTokens = Math.min(outputTokens, Math.max(0, asNumber(usage.reasoningTokens)));
  if (rawInput === 0 && outputTokens === 0) return null;

  const totalTokens = rawInput + outputTokens;
  const fallbackId = [
    "grok", identity.sessionId, identity.timestamp, identity.promptId, identity.model,
    inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, reasoningTokens,
  ].join(":");
  const ticks = Math.max(0, asNumber(usage.costUsdTicks));

  return {
    source: "grok",
    timestamp: identity.timestamp,
    sessionId: identity.sessionId,
    requestId: identity.eventId == null ? fallbackId : `${identity.eventId}:${identity.model}`,
    model: identity.model,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    reasoningTokens,
    totalTokens,
    reportedCostUSD: ticks > 0 ? ticks / COST_USD_TICKS_PER_USD : undefined,
  };
}

async function scanGrokFile(file: string): Promise<GrokScanResult> {
  const facts: UsageFact[] = [];
  const turns: UsageTurn[] = [];
  await readJsonlFile(file, (value) => {
    const record = asRecord(value);
    const params = asRecord(record?.params);
    const update = asRecord(params?.update);
    const usage = asRecord(update?.usage);
    if (asString(update?.sessionUpdate) !== "turn_completed" || usage == null) return;

    const meta = asRecord(params?._meta);
    const timestamp = toIsoTimestamp(record?.timestamp ?? meta?.agentTimestampMs);
    if (timestamp == null) return;
    const sessionId = asString(params?.sessionId) ?? "unknown";
    const eventId = asString(meta?.eventId);
    const promptId = asString(update?.prompt_id) ?? "";
    turns.push({
      source: "grok",
      timestamp,
      key: eventId ?? ["grok", sessionId, timestamp, promptId].join(":"),
    });

    for (const [model, modelUsage] of usageRows(usage)) {
      const fact = usageFact(modelUsage, { sessionId, timestamp, promptId, eventId, model });
      if (fact != null) facts.push(fact);
    }
  });
  return { facts, turns };
}

export async function collectGrokUsage(context: CollectorContext): Promise<SourceCollection> {
  const source = "grok";
  const files = await listGrokSessionFiles(await getGrokHomes());
  const cache = await context.openScanCache?.<GrokScanResult>(source, `parser=${GROK_SCAN_VERSION}`);
  const entries: UsageEntry[] = [];
  const turns: UsageTurn[] = [];
  const seenEntries = new Set<string>();
  const seenTurns = new Set<string>();

  for (const file of files) {
    const stat = await statFile(file);
    let parsed = stat == null ? undefined : cache?.get(file, stat);
    if (parsed == null) {
      parsed = await scanGrokFile(file);
      if (stat != null) cache?.set(file, stat, parsed);
    }
    for (const fact of parsed.facts) {
      const key = fact.requestId ?? "";
      if (seenEntries.has(key)) continue;
      seenEntries.add(key);
      entries.push(priceUsageFact(fact, context));
    }
    for (const turn of parsed.turns) {
      if (seenTurns.has(turn.key)) continue;
      seenTurns.add(turn.key);
      turns.push(turn);
    }
  }

  await cache?.save();
  return { source, entries, turns, files: files.length, warnings: [] };
}

export const grokCollector: AgentSourceCollector = {
  source: "grok",
  label: "Grok",
  collect: collectGrokUsage,
};
