import { join } from "node:path";
import { homedir } from "node:os";
import {
  DEFAULT_OPENCODE_DIR,
  OPENCODE_DATA_DIR_ENV,
} from "@ccclub/shared";
import type { UsageEntry } from "@ccclub/shared";
import type { AgentSourceCollector, CollectorContext, SourceCollection, UsageTurn } from "./types.js";
import {
  asNumber,
  asRecord,
  asString,
  existingDirectories,
  globFiles,
  parsePathList,
  readJsonFile,
  statFile,
  toIsoTimestamp,
} from "./shared.js";

interface OpenCodeMessageRow {
  id: string;
  sessionId?: string;
  data: unknown;
}

// A row claims its message ID even when it yields no usage entry, so dedup
// between the DB and JSON copies of the same message stays stable.
interface OpenCodeParsedRow {
  id: string;
  entry: UsageEntry | null;
}

function getOpenCodeDirs(): Promise<string[]> {
  const dirs = parsePathList(process.env[OPENCODE_DATA_DIR_ENV], [join(homedir(), DEFAULT_OPENCODE_DIR)]);
  return existingDirectories(dirs);
}

function parseOpenCodeMessage(row: OpenCodeMessageRow, context: CollectorContext): UsageEntry | null {
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
  const costUSD = asNumber(record.cost) || context.calculateCost(
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

async function loadOpenCodeJsonRows(
  openCodeDirs: string[],
  context: CollectorContext,
): Promise<{ rows: OpenCodeParsedRow[]; files: number }> {
  const messageDirs = openCodeDirs.map((dir) => join(dir, "storage", "message"));
  const files = await globFiles(await existingDirectories(messageDirs), "**/*.json");
  // Message files are written once per message, which makes them ideal cache
  // targets: thousands of files of which only the newest ever change.
  const cache = await context.openScanCache?.<OpenCodeParsedRow | null>("opencode", context.pricingVersion);
  const rows: OpenCodeParsedRow[] = [];

  for (const file of files) {
    const stat = await statFile(file);
    const cached = stat != null ? cache?.get(file, stat) : undefined;
    if (cached !== undefined) {
      if (cached != null) rows.push(cached);
      continue;
    }

    const data = await readJsonFile(file);
    const record = asRecord(data);
    const id = asString(record?.id);
    const row = id == null
      ? null
      : { id, entry: parseOpenCodeMessage({ id, sessionId: asString(record?.sessionID), data }, context) };
    if (stat != null) cache?.set(file, stat, row);
    if (row != null) rows.push(row);
  }

  await cache?.save();
  return { rows, files: files.length };
}

async function loadNodeSqlite(): Promise<{ DatabaseSync: new (path: string, options?: unknown) => any } | null> {
  try {
    return await import("node:sqlite") as { DatabaseSync: new (path: string, options?: unknown) => any };
  } catch {
    return null;
  }
}

// The SQLite databases are always re-read: with WAL journaling the main db
// file's mtime does not track writes, so stat-based caching would go stale.
// A couple of sqlite reads per sync is cheap; the JSON file sprawl is not.
async function loadOpenCodeDbRows(
  openCodeDirs: string[],
  context: CollectorContext,
): Promise<{ rows: OpenCodeParsedRow[]; files: number }> {
  const dbFiles = Array.from(new Set([
    ...(await globFiles(openCodeDirs, "opencode.db")),
    ...(await globFiles(openCodeDirs, "opencode-*.db")),
  ]));
  if (dbFiles.length === 0) return { rows: [], files: 0 };

  const sqlite = await loadNodeSqlite();
  if (sqlite == null) return { rows: [], files: 0 };

  const rows: OpenCodeParsedRow[] = [];

  for (const dbFile of dbFiles) {
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
          const data = JSON.parse(dataText) as unknown;
          rows.push({ id, entry: parseOpenCodeMessage({ id, sessionId: asString(raw.session_id), data }, context) });
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

  return { rows, files: dbFiles.length };
}

export async function collectOpenCodeUsage(context: CollectorContext): Promise<SourceCollection> {
  const source = "opencode";
  const openCodeDirs = await getOpenCodeDirs();
  const [jsonResult, dbResult] = await Promise.all([
    loadOpenCodeJsonRows(openCodeDirs, context),
    loadOpenCodeDbRows(openCodeDirs, context),
  ]);
  const rows = [...dbResult.rows, ...jsonResult.rows];
  const entries: UsageEntry[] = [];
  const turns: UsageTurn[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    if (row.entry == null) continue;
    entries.push(row.entry);
    turns.push({ source, timestamp: row.entry.timestamp, key: `${source}:${row.id}` });
  }

  return {
    source,
    entries,
    turns,
    files: jsonResult.files + dbResult.files,
    warnings: [],
  };
}

export const openCodeCollector: AgentSourceCollector = {
  source: "opencode",
  label: "OpenCode",
  collect: collectOpenCodeUsage,
};
