import { join } from "node:path";
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
  parsePathList,
  readJsonlFile,
  statFile,
  toIsoTimestamp,
} from "./shared.js";

const GROK_SCAN_VERSION = 1;
const FALLBACK_MODEL = "grok-4.6";

interface GrokScanResult {
  facts: UsageFact[];
  turns: UsageTurn[];
}

function getGrokHomes(): Promise<string[]> {
  const dirs = parsePathList(process.env[GROK_HOME_ENV], [join(homedir(), DEFAULT_GROK_DIR)]);
  return existingDirectories(dirs);
}

async function listGrokLogFiles(homes: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const home of homes) {
    const file = join(home, "logs", "unified.jsonl");
    if (await statFile(file) != null) files.push(file);
  }
  return files;
}

function announcedModel(msg: string, ctx: Record<string, unknown> | null): string | undefined {
  if (ctx == null) return undefined;
  if (msg === "model changed") return asString(ctx.model);
  if (msg === "backend_search: model switch") return asString(ctx.new_model);
  if (msg === "model catalog: notifying clients") return asString(ctx.current_model_id);
  return undefined;
}

function resolveModel(
  sid: string | undefined,
  pid: number,
  sidModel: Map<string, string>,
  pidModel: Map<number, string>,
  lastModel: string | undefined,
): string {
  if (sid != null && sidModel.has(sid)) return sidModel.get(sid)!;
  if (pid > 0 && pidModel.has(pid)) return pidModel.get(pid)!;
  return lastModel ?? FALLBACK_MODEL;
}

async function scanGrokFile(file: string): Promise<GrokScanResult> {
  const source = "grok";
  const facts: UsageFact[] = [];
  const turns: UsageTurn[] = [];
  const sidModel = new Map<string, string>();
  const pidModel = new Map<number, string>();
  let lastModel: string | undefined;

  await readJsonlFile(file, (value) => {
    const record = asRecord(value);
    const msg = asString(record?.msg);
    if (msg == null) return;

    const ctx = asRecord(record?.ctx);
    const model = announcedModel(msg, ctx);
    if (model != null) {
      lastModel = model;
      const sid = asString(record?.sid);
      const pid = asNumber(record?.pid);
      if (sid != null) sidModel.set(sid, model);
      if (pid > 0) pidModel.set(pid, model);
      return;
    }

    const timestamp = toIsoTimestamp(record?.ts);
    if (timestamp == null) return;

    const sessionId = asString(record?.sid) ?? "unknown";

    if (msg === "shell.handle_prompt.start") {
      const promptId = asString(ctx?.prompt_id) ?? "";
      turns.push({
        source,
        timestamp,
        key: [source, sessionId, timestamp, promptId].join(":"),
      });
      return;
    }

    if (msg !== "shell.turn.inference_done" || ctx == null) return;

    const promptTotal = Math.max(0, asNumber(ctx.prompt_tokens));
    const cached = Math.min(Math.max(0, asNumber(ctx.cached_prompt_tokens)), promptTotal);
    const inputTokens = promptTotal - cached;
    const outputTokens = Math.max(0, asNumber(ctx.completion_tokens));
    const reasoningTokens = Math.max(0, asNumber(ctx.reasoning_tokens));
    if (promptTotal === 0 && outputTokens === 0 && reasoningTokens === 0) return;

    const resolved = asString(ctx.model) ?? resolveModel(
      asString(record?.sid),
      asNumber(record?.pid),
      sidModel,
      pidModel,
      lastModel,
    );
    const totalTokens = promptTotal + outputTokens + reasoningTokens;
    const requestId = [
      source,
      sessionId,
      timestamp,
      resolved,
      inputTokens,
      outputTokens,
      cached,
      reasoningTokens,
      totalTokens,
    ].join(":");

    facts.push({
      source,
      timestamp,
      sessionId,
      requestId,
      model: resolved,
      inputTokens,
      outputTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: cached,
      reasoningTokens,
      totalTokens,
    });
  });

  return { facts, turns };
}

export async function collectGrokUsage(context: CollectorContext): Promise<SourceCollection> {
  const source = "grok";
  const files = await listGrokLogFiles(await getGrokHomes());
  const cache = await context.openScanCache?.<GrokScanResult>(source, `parser=${GROK_SCAN_VERSION}`);
  const entries: UsageEntry[] = [];
  const turns: UsageTurn[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const stat = await statFile(file);
    let parsed = stat != null ? cache?.get(file, stat) : undefined;
    if (parsed == null) {
      parsed = await scanGrokFile(file);
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
