import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CURSOR_ACCESS_TOKEN_ENV } from "@ccclub/shared";
import type { UsageEntry } from "@ccclub/shared";
import type { AgentSourceCollector, CollectorContext, SourceCollection, UsageFact, UsageTurn } from "./types.js";
import { priceUsageFact } from "./types.js";
import {
  cursorTotalTokens,
  parseCursorEventsPage,
  type CursorEvent,
} from "./cursor-parse.js";
import { byTimestamp } from "./shared.js";

const execFileAsync = promisify(execFile);

const CURSOR_API_BASE = "https://api2.cursor.sh";
const CURSOR_USER_AGENT = "cursor-agent/2026.08.11";
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const LOOKBACK_MS = 400 * 24 * 60 * 60 * 1000;
/**
 * How far before the last synced block an incremental fetch reaches back. The
 * watermark is the START of the newest block already synced, so that block is
 * usually still open: an hour covers it and the events the dashboard publishes
 * late into it. Reaching back further buys nothing — filterBlocksToSync drops
 * every block older than the watermark before upload anyway — while every
 * extra hour is more pages for a heavy user's five-minute background sync.
 * Re-fetched events dedupe on request key, so overlap costs a request, never
 * a double count.
 */
const OVERLAP_MS = 60 * 60 * 1000;

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

/**
 * The dashboard window to request. Incremental once a sync has landed, so a
 * heavy user's five-minute background sync is one page instead of fifty. A
 * missing or unparsable watermark (never synced, or a forced full sync, which
 * passes none) means the whole retention window.
 */
export function cursorStartMs(lastSyncIso: string | undefined, nowMs: number): number {
  const floor = nowMs - LOOKBACK_MS;
  const lastSyncMs = lastSyncIso == null ? NaN : Date.parse(lastSyncIso);
  if (!Number.isFinite(lastSyncMs)) return floor;
  return Math.max(floor, lastSyncMs - OVERLAP_MS);
}

export async function collectCursorEvents(
  deps: CursorCollectorDeps = {},
  window: { startMs?: number; nowMs?: number } = {},
): Promise<{ events: CursorEvent[]; files: number; warning?: string; truncated?: boolean }> {
  const readToken = deps.readToken ?? defaultReadCursorToken;
  const fetchPage = deps.fetchPage ?? defaultFetchCursorPage;
  const token = await readToken();
  if (token == null) {
    return { events: [], files: 0 };
  }

  const nowMs = window.nowMs ?? Date.now();
  const startMs = window.startMs ?? nowMs - LOOKBACK_MS;
  const events: CursorEvent[] = [];
  let fetched = 0;
  let total: number | null = null;
  let truncated = false;

  try {
    // The dashboard returns events newest-first and reports the full match
    // count, so paging stops on that count rather than on a short page: rows
    // this parser rejects (zero-usage placeholders) shrink a page without
    // meaning the results ended. Only a page with no rows at all, or an
    // absent total, leaves a short page as the end-of-results signal.
    for (let page = 1; page <= MAX_PAGES; page++) {
      const parsed = parseCursorEventsPage(await fetchPage(token, page, startMs, nowMs));
      if (page === 1) total = parsed.total;
      events.push(...parsed.events);
      fetched += parsed.rawCount;
      if (parsed.rawCount === 0) break;
      if (total != null) {
        if (fetched >= total) break;
      } else if (parsed.rawCount < PAGE_SIZE) {
        break;
      }
      truncated = page === MAX_PAGES;
    }
  } catch (error) {
    return {
      events: [],
      files: 0,
      warning: `Cursor: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    events,
    // Reporting a record only when there is something to report: files > 0 is
    // what makes a full sync replace Cursor's stored history, and an empty or
    // reshaped API response must never be read as "this user has no history".
    files: events.length > 0 ? 1 : 0,
    // Newest-first means truncation drops the oldest events, so say so rather
    // than let a first sync silently under-report a long history. The flag
    // travels with it because sync has to hold the watermark back too.
    ...(truncated
      ? {
        truncated: true,
        warning: `Cursor: only the most recent ${MAX_PAGES * PAGE_SIZE} usage events were read`,
      }
      : {}),
  };
}

export function eventsToCollection(events: CursorEvent[], context: CollectorContext): SourceCollection {
  const source = "cursor";
  const entries: UsageEntry[] = [];
  const turns: UsageTurn[] = [];
  const seen = new Set<string>();
  const seenConversations = new Set<string>();
  let withoutReportedCost = 0;

  const sorted = [...events].sort(byTimestamp);

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
      totalTokens: cursorTotalTokens(event),
      // Cursor's own number whenever it gave one, including 0: it bills per
      // request and reports what it charged, so falling back to the LiteLLM
      // table would put an invented price on an included request (that table
      // never returns 0 for a known model family). A row with no cents field
      // at all is a different thing — nothing was reported, so the key stays
      // off and the pricing table answers.
      ...(event.costUSD === undefined ? {} : { reportedCostUSD: event.costUSD }),
    };
    if (event.costUSD === undefined) withoutReportedCost++;
    entries.push(priceUsageFact(fact, context));

    // One turn per conversation, not per prompt. The dashboard exposes no
    // prompt boundary, only the conversation an event belongs to, so Cursor's
    // turn counts are coarser than the log-derived ones of other sources.
    const conversationKey = event.conversationId ?? requestId;
    if (!seenConversations.has(conversationKey)) {
      seenConversations.add(conversationKey);
      turns.push({ source, timestamp: event.timestamp, key: `${source}:${conversationKey}` });
    }
  }

  return {
    source,
    entries,
    turns,
    files: entries.length > 0 ? 1 : 0,
    // One line, not one per event. Cursor has always sent a cents field, so a
    // run where some rows have none is a schema drift worth seeing — those
    // entries silently switched to pricing-table estimates.
    warnings: withoutReportedCost > 0
      ? [`Cursor: ${withoutReportedCost} usage event${withoutReportedCost === 1 ? "" : "s"} reported no cost — estimated from the pricing table instead`]
      : [],
  };
}

export async function collectCursorUsage(
  context: CollectorContext,
  deps: CursorCollectorDeps = {},
  nowMs = Date.now(),
): Promise<SourceCollection> {
  const { events, files, warning, truncated } = await collectCursorEvents(deps, {
    startMs: cursorStartMs(context.lastSyncBySource?.cursor, nowMs),
    nowMs,
  });
  const fetchWarnings = warning ? [warning] : [];
  if (files === 0) {
    return {
      source: "cursor",
      entries: [],
      turns: [],
      files: 0,
      warnings: fetchWarnings,
      ...(truncated ? { truncated: true } : {}),
    };
  }
  const collection = eventsToCollection(events, context);
  return {
    ...collection,
    files,
    warnings: [...fetchWarnings, ...collection.warnings],
    ...(truncated ? { truncated: true } : {}),
  };
}

export const cursorCollector: AgentSourceCollector = {
  source: "cursor",
  label: "Cursor",
  collect: collectCursorUsage,
};
