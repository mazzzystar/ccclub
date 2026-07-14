import { createReadStream } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import {
  CODEX_HOME_ENV,
  DEFAULT_CODEX_DIR,
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

interface RawCodexUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

// Part of the per-file scan-cache key. Bump whenever parsing/dedup semantics
// change so a new release cannot reuse entries produced by an older parser.
const CODEX_SCAN_VERSION = 3;
const codexFastServiceTierRegex = /(?:^|\n)\s*service_tier\s*=\s*["']?(?:fast|priority)["']?/iu;

interface CodexUsageSource {
  /** One configured CODEX_HOME. Distinguishes identical relative paths across homes. */
  home: string;
  /** A physical usage directory: live sessions or archived sessions. */
  dir: string;
}

interface CodexUsageFile {
  source: CodexUsageSource;
  file: string;
}

function getCodexHomes(): string[] {
  return parsePathList(process.env[CODEX_HOME_ENV], [join(homedir(), DEFAULT_CODEX_DIR)]);
}

async function getCodexUsageSources(): Promise<CodexUsageSource[]> {
  // Active files win when an archive move briefly leaves the same relative
  // path in both directories. Different CODEX_HOMEs remain independent.
  const homes = getCodexHomes();
  const candidates = homes.flatMap((home) => [
    { home, dir: join(home, "sessions") },
    { home, dir: join(home, "archived_sessions") },
  ]);
  const existing = new Set(await existingDirectories(candidates.map(({ dir }) => dir)));
  return candidates.filter(({ dir }) => existing.has(dir));
}

async function getCodexUsageFiles(sources: CodexUsageSource[]): Promise<CodexUsageFile[]> {
  const seen = new Set<string>();
  const files: CodexUsageFile[] = [];

  for (const source of sources) {
    for (const file of await globFiles([source.dir], "**/*.jsonl")) {
      const relativePath = relative(source.dir, file).split(sep).join("/");
      const key = `${source.home}\0${relativePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      files.push({ source, file });
    }
  }

  return files;
}

async function getCodexPricingTier(): Promise<"standard" | "fast"> {
  for (const home of getCodexHomes()) {
    try {
      const config = await readFile(join(home, "config.toml"), "utf8");
      if (codexFastServiceTierRegex.test(config)) return "fast";
    } catch {
      // Missing or unreadable config means standard pricing.
    }
  }
  return "standard";
}

function normalizeRawUsage(value: unknown): RawCodexUsage | null {
  const record = asRecord(value);
  if (record == null) return null;

  const inputTokens = asNumber(record.input_tokens);
  const cachedInputTokens = asNumber(record.cached_input_tokens ?? record.cache_read_input_tokens);
  const outputTokens = asNumber(record.output_tokens);
  const reasoningTokens = asNumber(record.reasoning_output_tokens);
  // Match ccusage: when Codex omits total_tokens, include reasoning_output_tokens
  // in the fallback total while still pricing only the reported output_tokens.
  const fallbackTotal = inputTokens + outputTokens + reasoningTokens;
  const totalTokens = asNumber(record.total_tokens) || fallbackTotal;

  return { inputTokens, cachedInputTokens, outputTokens, reasoningTokens, totalTokens };
}

function subtractUsage(current: RawCodexUsage, previous: RawCodexUsage | null): RawCodexUsage {
  return {
    inputTokens: Math.max(current.inputTokens - (previous?.inputTokens ?? 0), 0),
    cachedInputTokens: Math.max(current.cachedInputTokens - (previous?.cachedInputTokens ?? 0), 0),
    outputTokens: Math.max(current.outputTokens - (previous?.outputTokens ?? 0), 0),
    reasoningTokens: Math.max(current.reasoningTokens - (previous?.reasoningTokens ?? 0), 0),
    totalTokens: Math.max(current.totalTokens - (previous?.totalTokens ?? 0), 0),
  };
}

function extractModelFromPayload(payload: unknown): string | undefined {
  const payloadRecord = asRecord(payload);
  const info = asRecord(payloadRecord?.info);
  const metadata = asRecord(info?.metadata) ?? asRecord(payloadRecord?.metadata);
  return (
    asString(info?.model) ??
    asString(info?.model_name) ??
    asString(metadata?.model) ??
    asString(payloadRecord?.model) ??
    asString(payloadRecord?.model_name)
  );
}

function sessionIdForFile(sessionDir: string, file: string): string {
  return relative(sessionDir, file).split(sep).join("/").replace(/\.jsonl$/i, "");
}

function timestampSecond(value: unknown): string | null {
  return toIsoTimestamp(value)?.slice(0, 19) ?? null;
}

async function hasReplayMarker(file: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(file, "r");
    const buffer = Buffer.allocUnsafe(16 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.toString("utf8", 0, bytesRead);
    return header.includes("thread_spawn") || header.includes("forked_from_id");
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Codex rewrites copied fork/sub-agent history with the child's outer
 * timestamp. In affected rollouts, at least the first two copied token_count
 * records share the child's creation second; the child's own work begins at a
 * later second. This is the same conservative boundary used by ccusage 20:
 * requiring two records avoids dropping a legitimate first request that just
 * happened to complete in the session-creation second.
 */
async function detectReplaySecond(file: string): Promise<string | null> {
  if (!await hasReplayMarker(file)) return null;

  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  let firstSecond: string | null = null;

  try {
    for await (const line of lines) {
      let value: unknown;
      try {
        value = JSON.parse(line) as unknown;
      } catch {
        continue;
      }
      const record = asRecord(value);
      const payload = asRecord(record?.payload);
      if (record?.type !== "event_msg" || payload?.type !== "token_count") continue;
      const info = asRecord(payload.info);
      if (asRecord(info?.last_token_usage) == null && asRecord(info?.total_token_usage) == null) continue;
      const second = timestampSecond(record.timestamp);
      if (second == null) continue;
      if (firstSecond == null) {
        firstSecond = second;
        continue;
      }
      return firstSecond === second ? second : null;
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  return null;
}

// Per-file parse result. Entries keep their content dedupe key as requestId;
// forked sessions replay identical history, so dedup must span files.
interface CodexFileScan {
  entries: UsageFact[];
  turns: UsageTurn[];
}

async function scanCodexFile(
  file: string,
  sessionId: string,
): Promise<CodexFileScan> {
  const source = "codex";
  const replaySecond = await detectReplaySecond(file);
  let skippingReplay = replaySecond != null;
  const entries: UsageFact[] = [];
  const turns: UsageTurn[] = [];
  let previousTotal: RawCodexUsage | null = null;
  let currentModel: string | undefined;
  let sawTaskStarted = false;
  const fallbackUserTurns: UsageTurn[] = [];
  const seenFallbackUserTurns = new Set<string>();

  await readJsonlFile(file, (value) => {
    const record = asRecord(value);
    if (record == null) return;
    const payload = asRecord(record.payload);
    const type = asString(record.type);
    const recordSecond = timestampSecond(record.timestamp);
    const isReplayStamped = skippingReplay && recordSecond === replaySecond;

    if (type === "turn_context") {
      currentModel = extractModelFromPayload(payload) ?? currentModel;
      return;
    }

    if (type === "event_msg" && payload?.type === "task_started") {
      if (isReplayStamped) return;
      const timestamp = toIsoTimestamp(payload.started_at ?? record.timestamp);
      if (timestamp == null) return;
      const turnId = asString(payload.turn_id);
      const key = turnId != null
        ? `${source}:${turnId}:${timestamp}`
        : `${source}:${timestamp}:task_started`;
      sawTaskStarted = true;
      turns.push({ source, timestamp, key });
      return;
    }

    if (type === "event_msg" && payload?.type === "user_message") {
      if (isReplayStamped) return;
      const timestamp = toIsoTimestamp(record.timestamp);
      if (timestamp == null) return;
      const key = `${source}:${timestamp}:user_message`;
      if (!seenFallbackUserTurns.has(key)) {
        seenFallbackUserTurns.add(key);
        fallbackUserTurns.push({ source, timestamp, key });
      }
      return;
    }

    if (type !== "event_msg" || payload?.type !== "token_count") return;
    const timestamp = toIsoTimestamp(record.timestamp);
    if (timestamp == null) return;

    const info = asRecord(payload.info);
    const lastUsage = normalizeRawUsage(info?.last_token_usage);
    const totalUsage = normalizeRawUsage(info?.total_token_usage);

    // Keep cumulative state aligned while discarding copied history. The first
    // token_count in a later second is the child's/fork's own usage.
    if (skippingReplay) {
      if (recordSecond === replaySecond) {
        if (totalUsage != null) previousTotal = totalUsage;
        return;
      }
      skippingReplay = false;
    }

    const rawUsage = lastUsage ?? (totalUsage == null ? null : subtractUsage(totalUsage, previousTotal));
    if (totalUsage != null) previousTotal = totalUsage;
    if (rawUsage == null) return;

    currentModel = extractModelFromPayload(payload) ?? currentModel;
    const model = currentModel ?? "gpt-5";
    const cacheReadTokens = Math.min(rawUsage.cachedInputTokens, rawUsage.inputTokens);
    const inputTokens = Math.max(rawUsage.inputTokens - cacheReadTokens, 0);
    const totalTokens = rawUsage.totalTokens > 0
      ? rawUsage.totalTokens
      : inputTokens + cacheReadTokens + rawUsage.outputTokens + rawUsage.reasoningTokens;

    if (
      inputTokens === 0 &&
      cacheReadTokens === 0 &&
      rawUsage.outputTokens === 0 &&
      rawUsage.reasoningTokens === 0
    ) {
      return;
    }

    const dedupeKey = [
      timestamp,
      model,
      inputTokens,
      cacheReadTokens,
      rawUsage.outputTokens,
      rawUsage.reasoningTokens,
      totalTokens,
    ].join(":");

    entries.push({
      source,
      timestamp,
      sessionId,
      requestId: dedupeKey,
      model,
      inputTokens,
      outputTokens: rawUsage.outputTokens,
      cacheCreationTokens: 0,
      cacheReadTokens,
      reasoningTokens: rawUsage.reasoningTokens,
      totalTokens,
    });
  });

  if (!sawTaskStarted) turns.push(...fallbackUserTurns);
  return { entries, turns };
}

export async function collectCodexUsage(context: CollectorContext): Promise<SourceCollection> {
  const source = "codex";
  const [usageSources, pricingTier] = await Promise.all([
    getCodexUsageSources(),
    getCodexPricingTier(),
  ]);
  const files = await getCodexUsageFiles(usageSources);
  const cache = await context.openScanCache?.<CodexFileScan>(
    source,
    `parser=${CODEX_SCAN_VERSION}`,
  );

  const entries: UsageEntry[] = [];
  const turns: UsageTurn[] = [];
  const seen = new Set<string>();
  const seenTurns = new Set<string>();

  for (const { source: usageSource, file } of files) {
    const stat = await statFile(file);
    let scan = stat != null ? cache?.get(file, stat) : undefined;
    if (scan == null) {
      scan = await scanCodexFile(
        file,
        sessionIdForFile(usageSource.dir, file),
      );
      if (stat != null) cache?.set(file, stat, scan);
    }

    for (const fact of scan.entries) {
      const entry = priceUsageFact(fact, context, pricingTier);
      const dedupeKey = entry.requestId ?? "";
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      entries.push(entry);
    }
    for (const turn of scan.turns) {
      if (seenTurns.has(turn.key)) continue;
      seenTurns.add(turn.key);
      turns.push(turn);
    }
  }

  await cache?.save();
  return { source, entries, turns, files: files.length, warnings: [] };
}

export const codexCollector: AgentSourceCollector = {
  source: "codex",
  label: "Codex",
  collect: collectCodexUsage,
};
