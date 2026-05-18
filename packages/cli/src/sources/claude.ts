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
  const seen = new Set<string>();
  const seenTurns = new Set<string>();

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
      const dedupeKey = requestId
        ? `${source}:${sessionId}:${requestId}`
        : [
            source,
            sessionId,
            timestamp,
            usage.input_tokens,
            usage.output_tokens,
            usage.cache_creation_input_tokens ?? 0,
            usage.cache_read_input_tokens ?? 0,
          ].join(":");
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      const inputTokens = usage.input_tokens || 0;
      const outputTokens = usage.output_tokens || 0;
      const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
      const cacheReadTokens = usage.cache_read_input_tokens || 0;
      const model = value.message.model || "unknown";
      const costUSD = value.costUSD && value.costUSD > 0
        ? value.costUSD
        : calculateCost(model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens);

      entries.push({
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
      });
    });
  }

  return { source, entries, turns, files: files.length, warnings: [] };
}

export const claudeCollector: AgentSourceCollector = {
  source: "claude",
  label: "Claude",
  collect: collectClaudeUsage,
};
