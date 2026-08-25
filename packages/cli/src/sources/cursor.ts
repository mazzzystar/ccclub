import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CURSOR_ACCESS_TOKEN_ENV } from "@ccclub/shared";
import type { UsageEntry } from "@ccclub/shared";
import type { AgentSourceCollector, CollectorContext, SourceCollection, UsageFact, UsageTurn } from "./types.js";
import { priceUsageFact } from "./types.js";
import {
  cursorDisplayTokens,
  parseCursorEventsPage,
  type CursorEvent,
} from "./cursor-parse.js";

const execFileAsync = promisify(execFile);

const CURSOR_API_BASE = "https://api2.cursor.sh";
const CURSOR_USER_AGENT = "cursor-agent/2026.08.11";
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const LOOKBACK_MS = 400 * 24 * 60 * 60 * 1000;

export interface CursorCollectorDeps {
  readToken?: () => Promise<string | undefined>;
  fetchPage?: (token: string, page: number, startMs: number, endMs: number) => Promise<unknown>;
}

async function readEnvToken(): Promise<string | undefined> {
  const value = process.env[CURSOR_ACCESS_TOKEN_ENV]?.trim();
  return value ? value : undefined;
}

/** macOS Keychain item written by Cursor / cursor-agent. Never reads the refresh token. */
async function readKeychainToken(): Promise<string | undefined> {
  if (process.platform !== "darwin") return undefined;
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/security",
      ["find-generic-password", "-s", "cursor-access-token", "-a", "cursor-user", "-w"],
      { timeout: 5_000 },
    );
    const token = stdout.trim();
    return token ? token : undefined;
  } catch {
    return undefined;
  }
}

export async function defaultReadCursorToken(): Promise<string | undefined> {
  return (await readEnvToken()) ?? (await readKeychainToken());
}

export async function defaultFetchCursorPage(
  token: string,
  page: number,
  startMs: number,
  endMs: number,
): Promise<unknown> {
  const response = await fetch(`${CURSOR_API_BASE}/aiserver.v1.DashboardService/GetFilteredUsageEvents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1",
      "User-Agent": CURSOR_USER_AGENT,
    },
    body: JSON.stringify({
      startDate: String(startMs),
      endDate: String(endMs),
      page,
      pageSize: PAGE_SIZE,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Cursor login expired");
  }
  if (!response.ok) {
    throw new Error(`Cursor dashboard HTTP ${response.status}`);
  }
  return response.json();
}

export async function collectCursorEvents(
  deps: CursorCollectorDeps = {},
  nowMs = Date.now(),
): Promise<{ events: CursorEvent[]; files: number; warning?: string }> {
  const readToken = deps.readToken ?? defaultReadCursorToken;
  const fetchPage = deps.fetchPage ?? defaultFetchCursorPage;
  const token = await readToken();
  if (token == null) {
    return { events: [], files: 0 };
  }

  const startMs = nowMs - LOOKBACK_MS;
  const events: CursorEvent[] = [];
  let fetched = 0;
  let total: number | null = null;

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const parsed = parseCursorEventsPage(await fetchPage(token, page, startMs, nowMs));
      if (page === 1) total = parsed.total;
      events.push(...parsed.events);
      fetched += parsed.rawCount;
      if (parsed.rawCount === 0 || parsed.rawCount < PAGE_SIZE) break;
      if (total != null && fetched >= total) break;
    }
  } catch (error) {
    return {
      events: [],
      files: 0,
      warning: `Cursor: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return { events, files: 1 };
}

export function eventsToCollection(events: CursorEvent[], context: CollectorContext): SourceCollection {
  const source = "cursor";
  const entries: UsageEntry[] = [];
  const turns: UsageTurn[] = [];
  const seen = new Set<string>();
  const seenConversations = new Set<string>();

  const sorted = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  for (const event of sorted) {
    const requestId = [
      source,
      event.conversationId ?? "",
      event.timestamp,
      event.model,
      event.inputTokens,
      event.outputTokens,
      event.cacheWriteTokens,
      event.cacheReadTokens,
    ].join(":");
    if (seen.has(requestId)) continue;
    seen.add(requestId);

    const fact: UsageFact = {
      source,
      timestamp: event.timestamp,
      sessionId: event.conversationId ?? "cursor",
      requestId,
      model: event.model,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cacheCreationTokens: event.cacheWriteTokens,
      cacheReadTokens: event.cacheReadTokens,
      totalTokens: cursorDisplayTokens(event),
      ...(event.costUSD > 0 ? { reportedCostUSD: event.costUSD } : {}),
    };
    entries.push(priceUsageFact(fact, context));

    const conversationKey = event.conversationId ?? requestId;
    if (!seenConversations.has(conversationKey)) {
      seenConversations.add(conversationKey);
      turns.push({ source, timestamp: event.timestamp, key: `${source}:${conversationKey}` });
    }
  }

  return { source, entries, turns, files: 1, warnings: [] };
}

export async function collectCursorUsage(
  context: CollectorContext,
  deps: CursorCollectorDeps = {},
): Promise<SourceCollection> {
  const { events, files, warning } = await collectCursorEvents(deps);
  if (files === 0) {
    return {
      source: "cursor",
      entries: [],
      turns: [],
      files: 0,
      warnings: warning ? [warning] : [],
    };
  }
  const collection = eventsToCollection(events, context);
  return { ...collection, files, warnings: warning ? [warning] : [] };
}

export const cursorCollector: AgentSourceCollector = {
  source: "cursor",
  label: "Cursor",
  collect: collectCursorUsage,
};
