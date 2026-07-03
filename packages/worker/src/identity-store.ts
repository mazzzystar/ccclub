import type { GroupRecord, GroupMember, UserRecord } from "@ccclub/shared";

const MAX_ALIAS_DEPTH = 10;

export async function resolveCanonicalUserId(kv: KVNamespace, userId: string): Promise<string> {
  let current = userId;
  const seen = new Set<string>();

  for (let i = 0; i < MAX_ALIAS_DEPTH; i++) {
    if (seen.has(current)) return current;
    seen.add(current);

    const next = await kv.get(`user_alias:${current}`, "text");
    if (!next) return current;
    current = next;
  }

  return current;
}

export async function getMergedUserIds(kv: KVNamespace, userId: string): Promise<string[]> {
  const canonical = await resolveCanonicalUserId(kv, userId);
  const merged = (await kv.get<string[]>(`merged_users:${canonical}`, "json")) || [];
  return Array.from(new Set([canonical, ...merged.filter((id) => id !== canonical)]));
}

export async function registerMergedUser(
  kv: KVNamespace,
  sourceUserId: string,
  targetUserId: string,
): Promise<string[]> {
  const sourceCanonical = await resolveCanonicalUserId(kv, sourceUserId);
  const targetCanonical = await resolveCanonicalUserId(kv, targetUserId);
  if (sourceCanonical === targetCanonical) {
    throw new Error("accounts are already merged");
  }

  const sourceMerged = (await kv.get<string[]>(`merged_users:${sourceCanonical}`, "json")) || [];
  const targetMerged = (await kv.get<string[]>(`merged_users:${targetCanonical}`, "json")) || [];
  const toMerge = [sourceCanonical, ...sourceMerged].filter((id) => id !== targetCanonical);
  const merged = Array.from(new Set([...targetMerged, ...toMerge]));

  await Promise.all(toMerge.map((id) => kv.put(`user_alias:${id}`, targetCanonical)));
  await kv.put(`merged_users:${targetCanonical}`, JSON.stringify(merged));
  return merged;
}

export async function getUserGroups(kv: KVNamespace, userId: string): Promise<string[]> {
  return (await kv.get<string[]>(`user_groups:${userId}`, "json")) || [];
}

export async function mergeUserGroups(kv: KVNamespace, targetUserId: string, sourceUserId: string): Promise<string[]> {
  const [targetGroups, sourceGroups] = await Promise.all([
    getUserGroups(kv, targetUserId),
    getUserGroups(kv, sourceUserId),
  ]);
  const merged = Array.from(new Set([...targetGroups, ...sourceGroups]));
  await kv.put(`user_groups:${targetUserId}`, JSON.stringify(merged));
  return merged;
}

export async function getUserDisplayRecord(kv: KVNamespace, userId: string): Promise<UserRecord> {
  const groups = await getUserGroups(kv, userId);
  const publicUsers = (await kv.get<string[]>("public_users", "json")) || [];
  const fallback: UserRecord = {
    userId,
    displayName: userId.slice(0, 8),
    avatar: "",
    visibility: publicUsers.includes(userId) ? "public" : "private",
    createdAt: new Date().toISOString(),
  };

  for (const code of groups) {
    const group = await kv.get<GroupRecord>(`group:${code}`, "json");
    const member = group?.members.find((m) => m.userId === userId);
    if (member) {
      return {
        ...fallback,
        displayName: member.displayName,
        avatar: member.avatar || "",
        plan: member.plan,
        url: member.url,
      };
    }
  }

  return fallback;
}

export async function getCanonicalMember(
  kv: KVNamespace,
  userId: string,
  fallback?: GroupMember,
): Promise<GroupMember> {
  const canonical = await resolveCanonicalUserId(kv, userId);
  const record = await getUserDisplayRecord(kv, canonical);

  return {
    userId: canonical,
    displayName: record.displayName,
    avatar: record.avatar || fallback?.avatar || "",
    plan: record.plan,
    url: record.url,
    joinedAt: fallback?.joinedAt || record.createdAt,
  };
}
