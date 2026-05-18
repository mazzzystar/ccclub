import { join } from "node:path";
import { homedir } from "node:os";
import {
  DEFAULT_OPENCODE_DIR,
  OPENCODE_DATA_DIR_ENV,
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
  readJsonFile,
  toIsoTimestamp,
} from "./shared.js";

interface OpenCodeMessageRow {
  id: string;
  sessionId?: string;
  data: unknown;
}

function getOpenCodeDirs(): Promise<string[]> {
  const dirs = parsePathList(process.env[OPENCODE_DATA_DIR_ENV], [join(homedir(), DEFAULT_OPENCODE_DIR)]);
  return existingDirectories(dirs);
}

function parseOpenCodeMessage(row: OpenCodeMessageRow): UsageEntry | null {
  const source = "opencode";
  const record = asRecord(row.data);
  if (record == null) return null;

  const tokens = asRecord(record.tokens);
  const cache = asRecord(tokens?.cache);
  const model = asString(record.modelID) ?? asString(record.model) ?? "unknown";
  const providerID = asString(record.providerID) ?? "unknown";
  if (model === "unknown" || tokens == null) return null;

  const time = asRecord(record.time);
  const timestamp = toIsoTimestamp(time?.created ?? time?.completed);
  if (timestamp == null) return null;

  const inputTokens = asNumber(tokens.input);
  const outputTokens = asNumber(tokens.output);
  const reasoningTokens = asNumber(tokens.reasoning);
  const cacheCreationTokens = asNumber(cache?.write);
  const cacheReadTokens = asNumber(cache?.read);
  if (
    inputTokens === 0 &&
    outputTokens === 0 &&
    reasoningTokens === 0 &&
    cacheCreationTokens === 0 &&
    cacheReadTokens === 0
  ) {
    return null;
  }

  const sessionId = row.sessionId ?? asString(record.sessionID) ?? "unknown";
  const costUSD = asNumber(record.cost) || calculateCost(
    model,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    reasoningTokens,
  );

  return {
    source,
    timestamp,
    sessionId,
    requestId: row.id,
    model: providerID === "unknown" ? model : `${providerID}/${model}`,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    reasoningTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens + reasoningTokens,
    costUSD,
  };
}

async function loadOpenCodeJsonRows(openCodeDirs: string[]): Promise<OpenCodeMessageRow[]> {
  const messageDirs = openCodeDirs.map((dir) => join(dir, "storage", "message"));
  const files = await globFiles(await existingDirectories(messageDirs), "**/*.json");
  const rows: OpenCodeMessageRow[] = [];

  for (const file of files) {
    const data = await readJsonFile(file);
    const record = asRecord(data);
    const id = asString(record?.id);
    if (id == null) continue;
    rows.push({ id, sessionId: asString(record?.sessionID), data });
  }

  return rows;
}

async function loadNodeSqlite(): Promise<{ DatabaseSync: new (path: string, options?: unknown) => any } | null> {
  try {
    return await import("node:sqlite") as { DatabaseSync: new (path: string, options?: unknown) => any };
  } catch {
    return null;
  }
}

async function loadOpenCodeDbRows(openCodeDirs: string[]): Promise<OpenCodeMessageRow[]> {
  const dbFiles = [
    ...(await globFiles(openCodeDirs, "opencode.db")),
    ...(await globFiles(openCodeDirs, "opencode-*.db")),
  ];
  if (dbFiles.length === 0) return [];

  const sqlite = await loadNodeSqlite();
  if (sqlite == null) return [];

  const rows: OpenCodeMessageRow[] = [];

  for (const dbFile of Array.from(new Set(dbFiles))) {
    let db: any;
    try {
      db = new sqlite.DatabaseSync(dbFile, { readOnly: true });
      const result = db.prepare("SELECT id, session_id, data FROM message").all() as Array<{
        id?: unknown;
        session_id?: unknown;
        data?: unknown;
      }>;
      for (const raw of result) {
        const id = asString(raw.id);
        const dataText = asString(raw.data);
        if (id == null || dataText == null) continue;
        try {
          rows.push({
            id,
            sessionId: asString(raw.session_id),
            data: JSON.parse(dataText) as unknown,
          });
        } catch {
          // Ignore malformed message rows.
        }
      }
    } catch {
      // OpenCode has changed storage formats over time; unsupported DBs are skipped.
    } finally {
      try {
        db?.close();
      } catch {
        // ignore
      }
    }
  }

  return rows;
}

export async function collectOpenCodeUsage(): Promise<SourceCollection> {
  const source = "opencode";
  const openCodeDirs = await getOpenCodeDirs();
  const [jsonRows, dbRows] = await Promise.all([
    loadOpenCodeJsonRows(openCodeDirs),
    loadOpenCodeDbRows(openCodeDirs),
  ]);
  const rows = [...dbRows, ...jsonRows];
  const entries: UsageEntry[] = [];
  const turns: UsageTurn[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const entry = parseOpenCodeMessage(row);
    if (entry == null) continue;
    entries.push(entry);
    turns.push({ source, timestamp: entry.timestamp, key: `${source}:${row.id}` });
  }

  return {
    source,
    entries,
    turns,
    files: jsonRows.length + dbRows.length,
    warnings: [],
  };
}

export const openCodeCollector: AgentSourceCollector = {
  source: "opencode",
  label: "OpenCode",
  collect: collectOpenCodeUsage,
};
