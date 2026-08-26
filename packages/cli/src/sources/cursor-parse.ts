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
  /**
   * Cursor's own charge for this event, in dollars. Undefined means the row
   * carried no cents field at all — a missing number, not a free request —
   * and the pricing table has to answer instead. An explicit 0 is a real
   * answer and stays 0.
   */
  costUSD: number | undefined;
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

/** Undefined, not 0, when the field is absent or unparsable — see CursorEvent.costUSD. */
export function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Which cents field Cursor's answer is. `totalCents` is the per-event charge
 * and wins whenever it is there; `chargedCents` is the row-level fallback,
 * used when totalCents is absent — and also when totalCents is 0 while
 * chargedCents is not, which is how the dashboard reports some usage-based
 * rows. With neither field present there is no answer to give.
 */
export function pickCursorCents(row: unknown): number | undefined {
  const record = asRecord(row);
  const totalCents = asFiniteNumber(asRecord(record?.tokenUsage)?.totalCents);
  const chargedCents = asFiniteNumber(record?.chargedCents);
  if (totalCents === undefined) return chargedCents;
  if (totalCents === 0 && chargedCents !== undefined && chargedCents > 0) return chargedCents;
  return totalCents;
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
  const cents = pickCursorCents(record);
  if (
    inputTokens === 0 &&
    outputTokens === 0 &&
    cacheWriteTokens === 0 &&
    cacheReadTokens === 0 &&
    (cents ?? 0) === 0
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
    costUSD: cents === undefined ? undefined : cents / 100,
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

/**
 * Total tokens, defined the same way as every other source: all four buckets.
 * Cursor's cacheRead is routinely 100× input+output, but that is true of
 * Claude Code too — the leaderboard's fairness comes from ranking on
 * getNonCacheTokens, not from a source quietly under-reporting its totals.
 */
export function cursorTotalTokens(event: CursorEvent): number {
  return event.inputTokens + event.outputTokens + event.cacheWriteTokens + event.cacheReadTokens;
}
