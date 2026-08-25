import { asRecord, asString, toIsoTimestamp } from "./shared.js";

/**
 * One Cursor dashboard usage event. Local agent-transcripts JSONL has no
 * token/cost fields (they are chat logs), so this is the only real usage
 * source — same conclusion as AgentDuck ADR-0022.
 */
export interface CursorEvent {
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUSD: number;
  conversationId?: string;
}

export function asInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return 0;
}

export function asFiniteNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function eventTimestamp(value: unknown): string | null {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return toIsoTimestamp(Number(value));
  }
  return toIsoTimestamp(value);
}

export function parseCursorEvent(row: unknown): CursorEvent | null {
  const record = asRecord(row);
  const timestamp = eventTimestamp(record?.timestamp);
  if (timestamp == null) return null;

  const usage = asRecord(record?.tokenUsage) ?? {};
  const inputTokens = asInt(usage.inputTokens);
  const outputTokens = asInt(usage.outputTokens);
  const cacheWriteTokens = asInt(usage.cacheWriteTokens);
  const cacheReadTokens = asInt(usage.cacheReadTokens);
  const cents = asFiniteNumber(usage.totalCents) || asFiniteNumber(record?.chargedCents);
  if (
    inputTokens === 0 &&
    outputTokens === 0 &&
    cacheWriteTokens === 0 &&
    cacheReadTokens === 0 &&
    cents === 0
  ) {
    return null;
  }

  return {
    timestamp,
    model: asString(record?.model) ?? "cursor",
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    costUSD: cents / 100,
    conversationId: asString(record?.conversationId),
  };
}

export function parseCursorEventsPage(data: unknown): {
  events: CursorEvent[];
  total: number | null;
  rawCount: number;
} {
  const record = asRecord(data);
  const rows = record?.usageEventsDisplay;
  const rawCount = Array.isArray(rows) ? rows.length : 0;
  const events = Array.isArray(rows)
    ? rows.map(parseCursorEvent).filter((event): event is CursorEvent => event != null)
    : [];
  const totalRaw = record?.totalUsageEventsCount;
  const total = totalRaw == null ? null : asInt(totalRaw);
  return { events, total, rawCount };
}

/** Display/leaderboard tokens: input + output. cacheRead is often 100× larger. */
export function cursorDisplayTokens(event: CursorEvent): number {
  return event.inputTokens + event.outputTokens;
}
