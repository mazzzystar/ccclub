// Change detection for `usage:<userId>` that costs one `list` instead of one
// read per member.
//
// A group board used to recompute by reading every member's `usage:` record,
// because nothing cheaper could say whose numbers had moved. On the largest
// group that was 88 reads and ~50 MB of JSON per recompute, a few times a
// minute, and about 80% of this account's KV read bill — almost all of it
// spent re-reading members who had not synced since the last recompute.
//
// Every write of a `usage:` record now carries `{ v: <write time> }` as KV
// metadata, which rides on the same put at no extra cost, and one `list` over
// the `usage:` prefix returns that metadata for up to 1,000 users at once. A
// recompute compares those versions with the ones its previous result was
// built from and reads only the members whose version moved.
//
// Records written before this existed carry no metadata and list as version 0,
// which is what the first recompute that reads them records as well, so they
// are re-read only once they are written again — i.e. once they change.

import type { UsageData } from "@ccclub/shared";

export interface UsageMetadata {
  /** Epoch ms of the write that stored this record. */
  v?: number;
}

/** Metadata to pass with every `usage:` put. */
export function usageVersion(now: number): { metadata: UsageMetadata } {
  return { metadata: { v: now } };
}

/**
 * The current version of every stored `usage:` record, keyed by userId.
 *
 * `list` is eventually consistent — a write can take up to a minute to show
 * up — which is the same staleness a plain read of another member's record
 * already has outside the writer's own location. A version that has not
 * surfaced yet is picked up by the next recompute that lists it; the board
 * never keeps an older number once a newer version is visible.
 */
export async function listUsageVersions(kv: KVNamespace): Promise<Map<string, number>> {
  const versions = new Map<string, number>();
  let cursor: string | undefined;
  do {
    const page = await kv.list<UsageMetadata>({ prefix: "usage:", cursor });
    for (const key of page.keys) versions.set(key.name.slice("usage:".length), key.metadata?.v ?? 0);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return versions;
}

/**
 * Value for `last_sync:<code>` written by a usage change: when, and whose.
 *
 * The time stays first so every existing reader — `parseInt`, and the OG
 * image cache key that embeds the raw string — keeps working unchanged. The
 * userId lets a recompute re-read the member who just synced even when
 * `list` has not caught up with their write yet: the CLI asks for its board
 * a fraction of a second after its own sync, from the same location, where a
 * read sees the write immediately but a listing may not.
 */
export function syncMarker(now: number, userId: string): string {
  return `${now}:${userId}`;
}

export function parseSyncMarker(raw: string | null): { at: number; userId?: string } {
  if (!raw) return { at: 0 };
  const at = parseInt(raw, 10);
  const colon = raw.indexOf(":");
  return { at: Number.isFinite(at) ? at : 0, userId: colon >= 0 ? raw.slice(colon + 1) || undefined : undefined };
}

/** One member's contribution to a cached board, with the version it was derived from. */
export interface MemberPart<P> {
  v: number;
  p: P;
}

/**
 * Each member's contribution to a board, reusing `carried` for every member
 * whose stored record has not changed since it was derived.
 *
 * With `carried` null every member is read — the first computation for a
 * window, a small group, or a periodic full refresh. Otherwise one listing
 * decides, and only members with a newer version, members missing from
 * `carried`, and `forceUserId` (the member named by the sync marker) are read.
 *
 * A read that comes back older than what `carried` already holds is a stale
 * copy at this location; the carried part wins, so a board never steps back.
 */
export async function loadMemberParts<P>(
  kv: KVNamespace,
  userIds: string[],
  carried: Record<string, MemberPart<P>> | null,
  forceUserId: string | undefined,
  derive: (usage: UsageData | null) => P,
): Promise<Record<string, MemberPart<P>>> {
  const versions = carried ? await listUsageVersions(kv) : null;
  const parts: Record<string, MemberPart<P>> = {};
  const toRead: string[] = [];
  for (const userId of userIds) {
    const prior = carried?.[userId];
    if (prior && versions && userId !== forceUserId && (versions.get(userId) ?? 0) <= prior.v) {
      parts[userId] = prior;
    } else {
      toRead.push(userId);
    }
  }

  const reads = await Promise.all(
    toRead.map((userId) => kv.getWithMetadata<UsageData, UsageMetadata>(`usage:${userId}`, "json")),
  );
  toRead.forEach((userId, i) => {
    const v = reads[i].metadata?.v ?? 0;
    const prior = carried?.[userId];
    parts[userId] = prior && v < prior.v ? prior : { v, p: derive(reads[i].value) };
  });
  return parts;
}
