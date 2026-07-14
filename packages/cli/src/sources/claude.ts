import { join, basename } from "node:path";
import { homedir } from "node:os";
import {
  CLAUDE_CONFIG_DIR_ENV,
  CLAUDE_CONFIG_PROJECTS_DIR,
  CLAUDE_PROJECTS_DIR,
} from "@ccclub/shared";
import type { CostCalculator, RawClaudeJSONLEntry, UsageEntry } from "@ccclub/shared";
import type { AgentSourceCollector, CollectorContext, SourceCollection, UsageTurn } from "./types.js";
import {
  asRecord,
  asNumber,
  asString,
  existingDirectories,
  globFiles,
  parsePathList,
  readJsonlFile,
  statFile,
  toIsoTimestamp,
} from "./shared.js";

function isProjectsPath(path: string): boolean {
  return basename(path) === "projects";
}

async function getClaudeProjectDirs(): Promise<string[]> {
  const envPaths = process.env[CLAUDE_CONFIG_DIR_ENV];
  const basePaths = parsePathList(
    envPaths,
    [join(homedir(), CLAUDE_CONFIG_PROJECTS_DIR), join(homedir(), CLAUDE_PROJECTS_DIR)],
  );
  const candidates = envPaths?.trim()
    ? basePaths.flatMap((path) => isProjectsPath(path) ? [path] : [join(path, "projects"), path])
    : basePaths;
  return existingDirectories(Array.from(new Set(candidates)));
}

/** RawClaudeJSONLEntry narrowed to the fields a usage record must carry. */
interface RawClaudeUsageEntry extends RawClaudeJSONLEntry {
  message: NonNullable<RawClaudeJSONLEntry["message"]> & {
    usage: NonNullable<NonNullable<RawClaudeJSONLEntry["message"]>["usage"]>;
  };
}

function isClaudeUsageEntry(value: unknown): value is RawClaudeUsageEntry {
  const entry = value as RawClaudeJSONLEntry;
  return entry?.type === "assistant" && typeof entry.timestamp === "string" && entry.message?.usage != null;
}

function isClaudeHumanTurn(value: unknown): value is RawClaudeJSONLEntry {
  const entry = value as RawClaudeJSONLEntry;
  if (entry?.type !== "user" || typeof entry.timestamp !== "string") return false;
  const content = entry.message?.content;
  return !(
    Array.isArray(content) &&
    content.length > 0 &&
    content.every((item) => asRecord(item)?.type === "tool_result")
  );
}

// Per-file parse result. Deduplication spans files (forks and sidechains
// replay records), so rows keep their dedup keys and are merged afterwards.
interface ClaudeUsageRow {
  entry: UsageEntry;
  exactKey: string;
  messageKey?: string;
  isSidechain: boolean;
}

interface ClaudeFileScan {
  rows: ClaudeUsageRow[];
  turns: UsageTurn[];
}

async function scanClaudeFile(file: string, calculateCost: CostCalculator): Promise<ClaudeFileScan> {
  const source = "claude";
  const rows: ClaudeUsageRow[] = [];
  const turns: UsageTurn[] = [];

  await readJsonlFile(file, (value) => {
    if (isClaudeHumanTurn(value)) {
      const timestamp = toIsoTimestamp(value.timestamp);
      if (timestamp == null) return;
      const sessionId = value.sessionId || "";
      turns.push({ source, timestamp, key: `${source}:${sessionId}:${timestamp}` });
      return;
    }

    if (!isClaudeUsageEntry(value)) return;
    const timestamp = toIsoTimestamp(value.timestamp);
    if (timestamp == null) return;

    const usage = value.message.usage;
    const sessionId = value.sessionId || "";
    const requestId = asString(value.requestId);
    const messageId = asString(value.message.id);
    const isSidechain = value.isSidechain === true || value.is_sidechain === true;
    const exactKey = messageId
      ? `message:${messageId}:request:${requestId ?? ""}`
      : [
          source,
          sessionId,
          timestamp,
          usage.input_tokens,
          usage.output_tokens,
          usage.cache_creation_input_tokens ?? 0,
          usage.cache_read_input_tokens ?? 0,
        ].join(":");
    const messageKey = messageId ? `message:${messageId}` : undefined;

    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
    const cacheCreation1hTokens = Math.min(
      Math.max(asNumber(usage.cache_creation?.ephemeral_1h_input_tokens), 0),
      Math.max(cacheCreationTokens, 0),
    );
    const cacheReadTokens = usage.cache_read_input_tokens || 0;
    const model = value.message.model || "unknown";
    const costUSD = value.costUSD && value.costUSD > 0
      ? value.costUSD
      : calculateCost(
          model,
          inputTokens,
          outputTokens,
          cacheCreationTokens,
          cacheReadTokens,
          0,
          cacheCreation1hTokens,
        );

    rows.push({
      exactKey,
      messageKey,
      isSidechain,
      entry: {
        source,
        timestamp,
        sessionId,
        requestId,
        model,
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheCreation1hTokens,
        cacheReadTokens,
        totalTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
        costUSD,
      },
    });
  });

  return { rows, turns };
}

function shouldReplaceEntry(candidate: UsageEntry, candidateIsSidechain: boolean, existing: UsageEntry, existingIsSidechain: boolean): boolean {
  if (candidateIsSidechain !== existingIsSidechain) {
    return existingIsSidechain;
  }
  if (candidate.totalTokens !== existing.totalTokens) {
    return candidate.totalTokens > existing.totalTokens;
  }
  return candidate.costUSD > existing.costUSD;
}

export async function collectClaudeUsage(context: CollectorContext): Promise<SourceCollection> {
  const source = "claude";
  const projectDirs = await getClaudeProjectDirs();
  const files = await globFiles(projectDirs, "**/*.jsonl");
  const cache = await context.openScanCache?.<ClaudeFileScan>(source, context.pricingVersion);

  // Cross-file dedup state; replayed records (forks, sidechains) collapse here.
  const entries: UsageEntry[] = [];
  const turns: UsageTurn[] = [];
  const exactEntryIndex = new Map<string, number>();
  const messageEntryIndexes = new Map<string, number[]>();
  const sidechainByEntryIndex: boolean[] = [];
  const seenTurns = new Set<string>();

  function addMessageIndex(key: string, index: number): void {
    const indexes = messageEntryIndexes.get(key) ?? [];
    if (!indexes.includes(index)) indexes.push(index);
    messageEntryIndexes.set(key, indexes);
  }

  function mergeRow(row: ClaudeUsageRow): void {
    const messageIndexes = row.messageKey != null ? messageEntryIndexes.get(row.messageKey) : undefined;
    const existingIndex = exactEntryIndex.get(row.exactKey) ??
      messageIndexes?.find((index) => row.isSidechain || sidechainByEntryIndex[index]);
    if (existingIndex != null) {
      if (shouldReplaceEntry(row.entry, row.isSidechain, entries[existingIndex], sidechainByEntryIndex[existingIndex])) {
        entries[existingIndex] = row.entry;
        sidechainByEntryIndex[existingIndex] = row.isSidechain;
        exactEntryIndex.set(row.exactKey, existingIndex);
        if (row.messageKey != null) addMessageIndex(row.messageKey, existingIndex);
      }
      return;
    }

    exactEntryIndex.set(row.exactKey, entries.length);
    if (row.messageKey != null) addMessageIndex(row.messageKey, entries.length);
    sidechainByEntryIndex.push(row.isSidechain);
    entries.push(row.entry);
  }

  for (const file of files) {
    // Stat before reading: a file that grows mid-read is cached under the
    // older stat and simply re-parses next run.
    const stat = await statFile(file);
    let scan = stat != null ? cache?.get(file, stat) : undefined;
    if (scan == null) {
      scan = await scanClaudeFile(file, context.calculateCost);
      if (stat != null) cache?.set(file, stat, scan);
    }

    for (const row of scan.rows) mergeRow(row);
    for (const turn of scan.turns) {
      if (seenTurns.has(turn.key)) continue;
      seenTurns.add(turn.key);
      turns.push(turn);
    }
  }

  await cache?.save();
  return { source, entries, turns, files: files.length, warnings: [] };
}

export const claudeCollector: AgentSourceCollector = {
  source: "claude",
  label: "Claude",
  collect: collectClaudeUsage,
};
