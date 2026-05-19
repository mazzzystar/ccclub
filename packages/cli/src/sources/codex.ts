import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { homedir } from "node:os";
import {
  CODEX_HOME_ENV,
  DEFAULT_CODEX_DIR,
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
  readJsonlFile,
  toIsoTimestamp,
} from "./shared.js";

interface RawCodexUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

const CODEX_FAST_COST_MULTIPLIER = 2;
const codexFastServiceTierRegex = /(?:^|\n)\s*service_tier\s*=\s*["']?(?:fast|priority)["']?/iu;

function getCodexHomes(): string[] {
  return parsePathList(process.env[CODEX_HOME_ENV], [join(homedir(), DEFAULT_CODEX_DIR)]);
}

function getCodexSessionDirs(): Promise<string[]> {
  const homes = getCodexHomes();
  return existingDirectories(homes.map((home) => join(home, "sessions")));
}

async function getCodexCostMultiplier(): Promise<number> {
  for (const home of getCodexHomes()) {
    try {
      const config = await readFile(join(home, "config.toml"), "utf8");
      if (codexFastServiceTierRegex.test(config)) return CODEX_FAST_COST_MULTIPLIER;
    } catch {
      // Missing or unreadable config means standard pricing.
    }
  }
  return 1;
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

export async function collectCodexUsage(): Promise<SourceCollection> {
  const source = "codex";
  const [sessionDirs, costMultiplier] = await Promise.all([
    getCodexSessionDirs(),
    getCodexCostMultiplier(),
  ]);
  const files = await globFiles(sessionDirs, "**/*.jsonl");
  const entries: UsageEntry[] = [];
  const turns: UsageTurn[] = [];
  const seen = new Set<string>();
  const seenTurns = new Set<string>();

  function addTurn(timestamp: string, key: string): void {
    if (seenTurns.has(key)) return;
    seenTurns.add(key);
    turns.push({ source, timestamp, key });
  }

  for (const sessionDir of sessionDirs) {
    const sessionFiles = files.filter((file) => file.startsWith(`${sessionDir}${sep}`));
    for (const file of sessionFiles) {
      const sessionId = sessionIdForFile(sessionDir, file);
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

        if (type === "turn_context") {
          currentModel = extractModelFromPayload(payload) ?? currentModel;
          return;
        }

        if (type === "event_msg" && payload?.type === "task_started") {
          const timestamp = toIsoTimestamp(payload.started_at ?? record.timestamp);
          if (timestamp == null) return;
          const turnId = asString(payload.turn_id);
          const key = turnId != null
            ? `${source}:${sessionId}:${turnId}`
            : `${source}:${sessionId}:${timestamp}:task_started`;
          sawTaskStarted = true;
          addTurn(timestamp, key);
          return;
        }

        if (type === "event_msg" && payload?.type === "user_message") {
          const timestamp = toIsoTimestamp(record.timestamp);
          if (timestamp == null) return;
          const key = `${source}:${sessionId}:${timestamp}:user_message`;
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
          source,
          sessionId,
          timestamp,
          model,
          inputTokens,
          cacheReadTokens,
          rawUsage.outputTokens,
          rawUsage.reasoningTokens,
          totalTokens,
        ].join(":");
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);

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
          reasoningTokens: 0,
          totalTokens,
          costUSD: calculateCost(model, inputTokens, rawUsage.outputTokens, 0, cacheReadTokens) * costMultiplier,
        });
      });

      if (!sawTaskStarted) {
        for (const turn of fallbackUserTurns) addTurn(turn.timestamp, turn.key);
      }
    }
  }

  return { source, entries, turns, files: files.length, warnings: [] };
}

export const codexCollector: AgentSourceCollector = {
  source: "codex",
  label: "Codex",
  collect: collectCodexUsage,
};
