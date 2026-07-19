import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { homedir } from "node:os";
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

interface CodexUsageSource {
  /** One configured CODEX_HOME. Distinguishes identical session ids across homes. */
  home: string;
  /** A physical usage directory: live sessions or archived sessions. */
  dir: string;
}

interface CodexUsageFile {
  source: CodexUsageSource;
  file: string;
  relativePath: string;
}

interface CodexTaskBoundary {
  recordIndex: number;
  rawTokenCount: number;
  startedAtMs: number | null;
}

interface IndexedUsageFact {
  fact: UsageFact;
  recordIndex: number;
  /** Zero-based raw token_count ordinal before this record is consumed. */
  rawTokenIndex: number;
}

interface IndexedUsageTurn {
  turn: UsageTurn;
  recordIndex: number;
  /** Number of raw token_count records seen before this event. */
  rawTokenCount: number;
}

interface CodexFileScan {
  logicalSessionId: string | null;
  forkedFromId: string | null;
  parentThreadId: string | null;
  sessionStartedAtMs: number | null;
  isSubagent: boolean;
  sessionMetaCount: number;
  parsedRecordCount: number;
  rawTokenCount: number;
  tokenTimes: number[];
  tokenFingerprints: string[];
  taskBoundaries: CodexTaskBoundary[];
  firstTaskBoundary: CodexTaskBoundary | null;
  ownTaskBoundary: CodexTaskBoundary | null;
  /** Conservative compatibility fallback for old same-second replay files. */
  legacyReplayTokenCount: number;
  entries: IndexedUsageFact[];
  taskTurns: IndexedUsageTurn[];
  fallbackUserTurns: IndexedUsageTurn[];
}

interface LoadedCodexScan {
  usageFile: CodexUsageFile;
  scan: CodexFileScan;
}

interface ReplayBoundary {
  rawTokenCount: number;
  recordIndex: number | null;
}

// Part of the per-file scan-cache key. Bump whenever parsing, replay indexing,
// or dedup semantics change so an older cached shape is never reused.
const CODEX_SCAN_VERSION = 4;
const OWN_TASK_START_WINDOW_MS = 5_000;
const UNRESOLVED_TOKEN_TIME = Number.MAX_SAFE_INTEGER;
const codexFastServiceTierRegex = /(?:^|\n)\s*service_tier\s*=\s*["']?(?:fast|priority)["']?/iu;

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
  const files: CodexUsageFile[] = [];

  for (const source of sources) {
    for (const file of await globFiles([source.dir], "**/*.jsonl")) {
      const relativePath = relative(source.dir, file).split(sep).join("/");
      // Keep both live/archive copies until their logical session ids and
      // completeness are known. Metadata-free legacy files are deduped by
      // this relative path after scanning.
      files.push({ source, file, relativePath });
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
  // OpenAI output_tokens already contains reasoning_output_tokens. Match
  // ccusage and the provider total when legacy records omit total_tokens.
  const fallbackTotal = inputTokens + outputTokens;
  const totalTokens = asNumber(record.total_tokens) || fallbackTotal;

  return { inputTokens, cachedInputTokens, outputTokens, reasoningTokens, totalTokens };
}

function usageCountersDecreased(current: RawCodexUsage, previous: RawCodexUsage): boolean {
  return current.inputTokens < previous.inputTokens ||
    current.cachedInputTokens < previous.cachedInputTokens ||
    current.outputTokens < previous.outputTokens ||
    current.reasoningTokens < previous.reasoningTokens ||
    current.totalTokens < previous.totalTokens;
}

function subtractUsage(current: RawCodexUsage, previous: RawCodexUsage): RawCodexUsage {
  return {
    inputTokens: current.inputTokens - previous.inputTokens,
    cachedInputTokens: current.cachedInputTokens - previous.cachedInputTokens,
    outputTokens: current.outputTokens - previous.outputTokens,
    reasoningTokens: current.reasoningTokens - previous.reasoningTokens,
    totalTokens: current.totalTokens - previous.totalTokens,
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

function timestampMs(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = new Date(value as string | number).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function epochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
    return timestampMs(value);
  }
  return null;
}

function isTaskStarted(payload: Record<string, unknown> | null): boolean {
  return payload?.type === "task_started" || payload?.type === "turn_started";
}

function isSubagentMeta(meta: Record<string, unknown>): boolean {
  if (meta.thread_source === "subagent") return true;
  const source = meta.source;
  if (source === "subagent") return true;
  const sourceRecord = asRecord(source);
  if (sourceRecord?.subagent != null) return true;
  return meta.parent_thread_id != null;
}

function extractParentThreadId(meta: Record<string, unknown>): string | null {
  const direct = asString(meta.parent_thread_id);
  if (direct != null) return direct;
  const source = asRecord(meta.source);
  const subagent = asRecord(source?.subagent);
  const spawn = asRecord(subagent?.thread_spawn);
  return asString(spawn?.parent_thread_id) ?? null;
}

function tokenFingerprint(payload: Record<string, unknown>): string {
  // Copied rollout items may receive a fresh outer timestamp, while the
  // token_count payload remains unchanged. Hash only that payload.
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("base64url")
    .slice(0, 16);
}

function upperBound(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = lo + ((hi - lo) >> 1);
    if (sorted[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Return the longest child prefix that is also a suffix of the parent
 * snapshot. Codex can copy full history or only Last-N-turns; requiring the
 * parent suffix avoids suppressing an unrelated repeated interior request.
 */
function longestReplayPrefix(child: string[], parent: string[]): number {
  if (child.length === 0 || parent.length === 0) return 0;

  const prefix = new Array<number>(child.length).fill(0);
  for (let i = 1, matched = 0; i < child.length; i++) {
    while (matched > 0 && child[i] !== child[matched]) matched = prefix[matched - 1];
    if (child[i] === child[matched]) matched++;
    prefix[i] = matched;
  }

  let matched = 0;
  for (let i = 0; i < parent.length; i++) {
    const fingerprint = parent[i];
    while (matched > 0 && fingerprint !== child[matched]) matched = prefix[matched - 1];
    if (fingerprint === child[matched]) matched++;
    if (matched === child.length && i < parent.length - 1) matched = prefix[matched - 1];
  }
  return matched;
}

async function scanCodexFile(file: string, physicalSessionId: string): Promise<CodexFileScan> {
  const source = "codex";
  let logicalSessionId: string | null = null;
  let forkedFromId: string | null = null;
  let parentThreadId: string | null = null;
  let sessionStartedAtMs: number | null = null;
  let isSubagent = false;
  let sessionMetaCount = 0;
  let parsedRecordCount = 0;
  let rawTokenCount = 0;
  let logicalTimestamp = Number.NEGATIVE_INFINITY;
  let pendingTokenTimeIndexes: number[] = [];
  let currentModel: string | undefined;
  let previousTotal: RawCodexUsage | null = null;
  let previousCumulativeTotal: number | null = null;
  let firstTokenSecond: string | null = null;
  let legacyReplayTokenCount = 0;
  let legacyPrefixOpen = true;

  const tokenTimes: number[] = [];
  const tokenFingerprints: string[] = [];
  const taskBoundaries: CodexTaskBoundary[] = [];
  let firstTaskBoundary: CodexTaskBoundary | null = null;
  let ownTaskBoundary: CodexTaskBoundary | null = null;
  const entries: IndexedUsageFact[] = [];
  const taskTurns: IndexedUsageTurn[] = [];
  const fallbackUserTurns: IndexedUsageTurn[] = [];
  const seenFallbackUserTurns = new Set<string>();

  await readJsonlFile(file, (value) => {
    const record = asRecord(value);
    if (record == null) return;
    parsedRecordCount++;

    const recordTimestamp = timestampMs(record.timestamp);
    if (recordTimestamp != null) {
      logicalTimestamp = Math.max(logicalTimestamp, recordTimestamp);
      for (const index of pendingTokenTimeIndexes) tokenTimes[index] = logicalTimestamp;
      pendingTokenTimeIndexes = [];
    }

    const payload = asRecord(record.payload);
    const type = asString(record.type);

    if (type === "session_meta" && payload != null) {
      sessionMetaCount++;
      if (sessionMetaCount === 1) {
        logicalSessionId = asString(payload.id) ?? null;
        forkedFromId = asString(payload.forked_from_id) ?? null;
        parentThreadId = extractParentThreadId(payload);
        isSubagent = isSubagentMeta(payload);
        sessionStartedAtMs = timestampMs(payload.timestamp) ?? recordTimestamp;
      }
    }

    if (type === "turn_context") {
      currentModel = extractModelFromPayload(payload) ?? currentModel;
      return;
    }

    if (type === "event_msg" && isTaskStarted(payload)) {
      const boundary: CodexTaskBoundary = {
        recordIndex: parsedRecordCount,
        rawTokenCount,
        startedAtMs: epochMs(payload?.started_at),
      };
      taskBoundaries.push(boundary);
      firstTaskBoundary ??= boundary;
      if (
        sessionStartedAtMs != null &&
        boundary.startedAtMs != null &&
        Math.abs(boundary.startedAtMs - sessionStartedAtMs) <= OWN_TASK_START_WINDOW_MS
      ) {
        // Keep the last match: copied parent tasks may share the spawn second.
        ownTaskBoundary = boundary;
      }

      const timestamp = toIsoTimestamp(payload?.started_at ?? record.timestamp);
      if (timestamp != null) {
        const turnId = asString(payload?.turn_id);
        const key = turnId != null
          ? `${source}:${turnId}:${timestamp}`
          : `${source}:${physicalSessionId}:${timestamp}:${String(payload?.type)}`;
        taskTurns.push({
          turn: { source, timestamp, key },
          recordIndex: parsedRecordCount,
          rawTokenCount,
        });
      }
      return;
    }

    if (type === "event_msg" && payload?.type === "user_message") {
      const timestamp = toIsoTimestamp(record.timestamp);
      if (timestamp == null) return;
      const key = `${source}:${physicalSessionId}:${timestamp}:user_message`;
      if (!seenFallbackUserTurns.has(key)) {
        seenFallbackUserTurns.add(key);
        fallbackUserTurns.push({
          turn: { source, timestamp, key },
          recordIndex: parsedRecordCount,
          rawTokenCount,
        });
      }
      return;
    }

    if (type !== "event_msg" || payload?.type !== "token_count") return;

    const rawTokenIndex = rawTokenCount;
    rawTokenCount++;
    tokenFingerprints.push(tokenFingerprint(payload));
    if (recordTimestamp == null) {
      // JSON caches cannot preserve Infinity (it becomes null), so use a
      // finite sentinel that remains later than any real Unix timestamp.
      tokenTimes.push(UNRESOLVED_TOKEN_TIME);
      pendingTokenTimeIndexes.push(tokenTimes.length - 1);
    } else {
      tokenTimes.push(logicalTimestamp);
    }

    const tokenSecond = toIsoTimestamp(record.timestamp)?.slice(0, 19) ?? null;
    if (legacyPrefixOpen) {
      if (firstTokenSecond == null && tokenSecond != null) {
        firstTokenSecond = tokenSecond;
        legacyReplayTokenCount = 1;
      } else if (tokenSecond != null && tokenSecond === firstTokenSecond) {
        legacyReplayTokenCount++;
      } else {
        legacyPrefixOpen = false;
      }
    }

    const info = asRecord(payload.info);
    if (info == null) return;

    const lastUsage = normalizeRawUsage(info.last_token_usage);
    const totalUsage = normalizeRawUsage(info.total_token_usage);
    const rawCumulativeTotal = asNumber(asRecord(info.total_token_usage)?.total_tokens);
    const isDuplicateEmission = rawCumulativeTotal > 0 && rawCumulativeTotal === previousCumulativeTotal;
    if (rawCumulativeTotal > 0) previousCumulativeTotal = rawCumulativeTotal;

    let rawUsage = lastUsage;
    if (rawUsage == null && totalUsage != null) {
      rawUsage = previousTotal == null || usageCountersDecreased(totalUsage, previousTotal)
        ? totalUsage
        : subtractUsage(totalUsage, previousTotal);
    }
    // The cumulative baseline is session-wide, including copied/duplicate
    // records and model switches, so always advance it before filtering.
    if (totalUsage != null) previousTotal = totalUsage;
    if (rawUsage == null || isDuplicateEmission) return;

    const timestamp = toIsoTimestamp(record.timestamp);
    if (timestamp == null) return;

    currentModel = extractModelFromPayload(payload) ?? currentModel;
    const model = currentModel ?? "gpt-5";
    const cacheReadTokens = Math.min(rawUsage.cachedInputTokens, rawUsage.inputTokens);
    const inputTokens = Math.max(rawUsage.inputTokens - cacheReadTokens, 0);
    const totalTokens = rawUsage.totalTokens > 0
      ? rawUsage.totalTokens
      : inputTokens + cacheReadTokens + rawUsage.outputTokens;

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
      fact: {
        source,
        timestamp,
        sessionId: physicalSessionId,
        requestId: dedupeKey,
        model,
        inputTokens,
        outputTokens: rawUsage.outputTokens,
        cacheCreationTokens: 0,
        cacheReadTokens,
        reasoningTokens: rawUsage.reasoningTokens,
        totalTokens,
      },
      recordIndex: parsedRecordCount,
      rawTokenIndex,
    });
  });

  // A single same-second request is not replay evidence.
  if (legacyReplayTokenCount < 2) legacyReplayTokenCount = 0;

  return {
    logicalSessionId,
    forkedFromId,
    parentThreadId,
    sessionStartedAtMs,
    isSubagent,
    sessionMetaCount,
    parsedRecordCount,
    rawTokenCount,
    tokenTimes,
    tokenFingerprints,
    taskBoundaries,
    firstTaskBoundary,
    ownTaskBoundary,
    legacyReplayTokenCount,
    entries,
    taskTurns,
    fallbackUserTurns,
  };
}

function replayBoundary(scan: CodexFileScan, parent: CodexFileScan | null): ReplayBoundary {
  const parentAtSpawn = parent != null && scan.sessionStartedAtMs != null
    ? upperBound(parent.tokenTimes, scan.sessionStartedAtMs)
    : null;
  const exactReplayTokenCount = parentAtSpawn == null || parent == null
    ? 0
    : longestReplayPrefix(
      scan.tokenFingerprints,
      parent.tokenFingerprints.slice(0, parentAtSpawn),
    );
  const legacyReplayTokenCount = (
    exactReplayTokenCount === 0 &&
    parent == null &&
    (
      scan.forkedFromId != null ||
      (scan.isSubagent && scan.sessionMetaCount > 1)
    )
  ) ? scan.legacyReplayTokenCount : 0;
  const replayTokenCount = Math.max(exactReplayTokenCount, legacyReplayTokenCount);

  if (scan.isSubagent) {
    // Exact Last-N matching can identify the child's own task even when it is
    // delayed beyond the five-second creation window.
    const matchedTaskBoundaries = replayTokenCount > 0
      ? scan.taskBoundaries.filter((boundary) => (
        boundary.rawTokenCount === replayTokenCount &&
        boundary.startedAtMs != null &&
        scan.sessionStartedAtMs != null &&
        boundary.startedAtMs >= Math.floor(scan.sessionStartedAtMs / 1000) * 1000
      ))
      : [];
    const matchedTaskBoundary = matchedTaskBoundaries.at(-1) ?? null;
    const direct = matchedTaskBoundary ??
      scan.ownTaskBoundary ??
      (scan.sessionMetaCount === 1 && scan.forkedFromId == null
        ? scan.firstTaskBoundary
        : null);
    if (direct != null) {
      return {
        rawTokenCount: Math.max(replayTokenCount, direct.rawTokenCount),
        recordIndex: direct.recordIndex,
      };
    }
    return { rawTokenCount: replayTokenCount, recordIndex: null };
  }

  if (scan.forkedFromId != null) {
    return { rawTokenCount: replayTokenCount, recordIndex: null };
  }
  return { rawTokenCount: 0, recordIndex: null };
}

function isReplayRecord(recordIndex: number, rawTokenIndex: number, boundary: ReplayBoundary): boolean {
  return (boundary.recordIndex != null && recordIndex < boundary.recordIndex) ||
    rawTokenIndex < boundary.rawTokenCount;
}

function sessionMapKey(home: string, sessionId: string): string {
  return `${home}\0${sessionId}`;
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

  const loaded: LoadedCodexScan[] = [];
  for (const usageFile of files) {
    const stat = await statFile(usageFile.file);
    let scan = stat != null ? cache?.get(usageFile.file, stat) : undefined;
    if (scan == null) {
      scan = await scanCodexFile(
        usageFile.file,
        sessionIdForFile(usageFile.source.dir, usageFile.file),
      );
      if (stat != null) cache?.set(usageFile.file, stat, scan);
    }
    loaded.push({ usageFile, scan });
  }

  // Keep the most complete physical copy for each logical session. This also
  // handles live/archive overlap when Codex moves a completed rollout under a
  // different path instead of preserving its relative filename.
  const sessionById = new Map<string, LoadedCodexScan>();
  const legacyFileByPath = new Map<string, LoadedCodexScan>();
  for (const item of loaded) {
    const id = item.scan.logicalSessionId;
    if (id == null) {
      const legacyKey = sessionMapKey(item.usageFile.source.home, item.usageFile.relativePath);
      if (!legacyFileByPath.has(legacyKey)) legacyFileByPath.set(legacyKey, item);
      continue;
    }
    const key = sessionMapKey(item.usageFile.source.home, id);
    const existing = sessionById.get(key);
    if (existing == null || item.scan.parsedRecordCount > existing.scan.parsedRecordCount) {
      sessionById.set(key, item);
    }
  }

  const entries: UsageEntry[] = [];
  const turns: UsageTurn[] = [];
  const seenEntries = new Set<string>();
  const seenTurns = new Set<string>();
  let selectedFiles = 0;

  for (const item of loaded) {
    const { usageFile, scan } = item;
    if (scan.logicalSessionId != null) {
      const ownKey = sessionMapKey(usageFile.source.home, scan.logicalSessionId);
      if (sessionById.get(ownKey) !== item) continue;
    } else {
      const legacyKey = sessionMapKey(usageFile.source.home, usageFile.relativePath);
      if (legacyFileByPath.get(legacyKey) !== item) continue;
    }
    selectedFiles += 1;

    const parentId = scan.forkedFromId ?? (scan.isSubagent ? scan.parentThreadId : null);
    const parent = parentId == null
      ? null
      : sessionById.get(sessionMapKey(usageFile.source.home, parentId))?.scan ?? null;
    const boundary = replayBoundary(scan, parent);

    for (const indexed of scan.entries) {
      if (isReplayRecord(indexed.recordIndex, indexed.rawTokenIndex, boundary)) continue;
      const entry = priceUsageFact(indexed.fact, context, pricingTier);
      const dedupeKey = entry.requestId ?? "";
      if (seenEntries.has(dedupeKey)) continue;
      seenEntries.add(dedupeKey);
      entries.push(entry);
    }

    const filteredTaskTurns = scan.taskTurns.filter((indexed) => !isReplayRecord(
      indexed.recordIndex,
      indexed.rawTokenCount,
      boundary,
    ));
    const candidateTurns = filteredTaskTurns.length > 0
      ? filteredTaskTurns
      : scan.fallbackUserTurns.filter((indexed) => !isReplayRecord(
        indexed.recordIndex,
        indexed.rawTokenCount,
        boundary,
      ));
    for (const indexed of candidateTurns) {
      if (seenTurns.has(indexed.turn.key)) continue;
      seenTurns.add(indexed.turn.key);
      turns.push(indexed.turn);
    }
  }

  await cache?.save();
  return { source, entries, turns, files: selectedFiles, warnings: [] };
}

export const codexCollector: AgentSourceCollector = {
  source: "codex",
  label: "Codex",
  collect: collectCodexUsage,
};
