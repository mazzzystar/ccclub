import { basename, join } from "node:path";
import { homedir } from "node:os";
import {
  DEFAULT_PI_AGENT_SESSIONS_DIR,
  PI_AGENT_DIR_ENV,
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
  readJsonlFile,
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

export async function collectPiUsage(): Promise<SourceCollection> {
  const source = "pi";
  const dirs = await getPiSessionDirs();
  const files = await globFiles(dirs, "**/*.jsonl");
  const entries: UsageEntry[] = [];
  const turns: UsageTurn[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const sessionId = extractSessionId(file);
    const project = extractProject(file);

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
      if (seen.has(key)) return;
      seen.add(key);

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
        costUSD: asNumber(cost?.total),
      });
      turns.push({ source, timestamp, key });
    });
  }

  return { source, entries, turns, files: files.length, warnings: [] };
}

export const piCollector: AgentSourceCollector = {
  source: "pi",
  label: "pi-agent",
  collect: collectPiUsage,
};
