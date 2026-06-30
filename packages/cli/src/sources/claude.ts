import { join, basename } from "node:path";
import { homedir } from "node:os";
import {
  CLAUDE_CONFIG_DIR_ENV,
  CLAUDE_CONFIG_PROJECTS_DIR,
  CLAUDE_PROJECTS_DIR,
  calculateCost,
} from "@ccclub/shared";
import type { RawClaudeJSONLEntry, UsageEntry } from "@ccclub/shared";
import type { AgentSourceCollector, SourceCollection, UsageTurn } from "./types.js";
import {
  asRecord,
  asString,
  existingDirectories,
  globFiles,
  parsePathList,
  readJsonlFile,
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

function isClaudeUsageEntry(value: unknown): value is RawClaudeJSONLEntry {
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

export async function collectClaudeUsage(): Promise<SourceCollection> {
  const source = "claude";
  const projectDirs = await getClaudeProjectDirs();
  const files = await globFiles(projectDirs, "**/*.jsonl");
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

  function shouldReplaceEntry(candidate: UsageEntry, candidateIsSidechain: boolean, existing: UsageEntry, existingIsSidechain: boolean): boolean {
    if (candidateIsSidechain !== existingIsSidechain) {
      return existingIsSidechain;
    }
    if (candidate.totalTokens !== existing.totalTokens) {
      return candidate.totalTokens > existing.totalTokens;
    }
    return candidate.costUSD > existing.costUSD;
  }

  for (const file of files) {
    await readJsonlFile(file, (value) => {
      if (isClaudeHumanTurn(value)) {
        const timestamp = toIsoTimestamp(value.timestamp);
        if (timestamp == null) return;
        const sessionId = value.sessionId || "";
        const key = `${source}:${sessionId}:${timestamp}`;
        if (!seenTurns.has(key)) {
          seenTurns.add(key);
          turns.push({ source, timestamp, key });
        }
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
      const exactDedupeKey = messageId
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
      const messageDedupeKey = messageId ? `message:${messageId}` : undefined;

      const inputTokens = usage.input_tokens || 0;
      const outputTokens = usage.output_tokens || 0;
      const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
      const cacheReadTokens = usage.cache_read_input_tokens || 0;
      const model = value.message.model || "unknown";
      const costUSD = value.costUSD && value.costUSD > 0
        ? value.costUSD
        : calculateCost(model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens);

      const entry = {
        source,
        timestamp,
        sessionId,
        requestId,
        model,
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        totalTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
        costUSD,
      } satisfies UsageEntry;

      const messageIndexes = messageDedupeKey != null ? messageEntryIndexes.get(messageDedupeKey) : undefined;
      const existingIndex = exactEntryIndex.get(exactDedupeKey) ??
        messageIndexes?.find((index) => isSidechain || sidechainByEntryIndex[index]);
      if (existingIndex != null) {
        if (shouldReplaceEntry(entry, isSidechain, entries[existingIndex], sidechainByEntryIndex[existingIndex])) {
          entries[existingIndex] = entry;
          sidechainByEntryIndex[existingIndex] = isSidechain;
          exactEntryIndex.set(exactDedupeKey, existingIndex);
          if (messageDedupeKey != null) addMessageIndex(messageDedupeKey, existingIndex);
        }
        return;
      }

      exactEntryIndex.set(exactDedupeKey, entries.length);
      if (messageDedupeKey != null) addMessageIndex(messageDedupeKey, entries.length);
      sidechainByEntryIndex.push(isSidechain);
      entries.push(entry);
    });
  }

  return { source, entries, turns, files: files.length, warnings: [] };
}

export const claudeCollector: AgentSourceCollector = {
  source: "claude",
  label: "Claude",
  collect: collectClaudeUsage,
};
