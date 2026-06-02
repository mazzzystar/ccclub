import type { UsageBlock, UsageData, UsageSnapshot } from "@ccclub/shared";
import { getMergedUserIds } from "./identity-store.js";

type UsageWrite = {
  blocks: UsageBlock[];
  usageSnapshot?: UsageSnapshot;
};

function blockKey(block: UsageBlock): string {
  return `${block.source ?? "claude"}:${block.blockStart}`;
}

function mergeBucketBlocks(existing: UsageBlock[], incoming: UsageBlock[]): UsageBlock[] {
  const blockMap = new Map<string, UsageBlock>();
  for (const block of existing) blockMap.set(blockKey(block), block);
  for (const block of incoming) blockMap.set(blockKey(block), block);
  return Array.from(blockMap.values()).sort(
    (a, b) =>
      new Date(a.blockStart).getTime() - new Date(b.blockStart).getTime() ||
      (a.source ?? "claude").localeCompare(b.source ?? "claude"),
  );
}

function latestIso(values: Array<string | undefined>): string {
  let latest = "";
  for (const value of values) {
    if (!value) continue;
    if (!latest || new Date(value).getTime() > new Date(latest).getTime()) {
      latest = value;
    }
  }
  return latest;
}

function latestSnapshot(values: Array<UsageSnapshot | undefined>): UsageSnapshot | undefined {
  let latest: UsageSnapshot | undefined;
  for (const value of values) {
    if (!value) continue;
    if (!latest || new Date(value.snapshotAt).getTime() > new Date(latest.snapshotAt).getTime()) {
      latest = value;
    }
  }
  return latest;
}

async function putUsageData(kv: KVNamespace, key: string, write: UsageWrite): Promise<UsageData> {
  const existing = (await kv.get<UsageData>(key, "json")) || { blocks: [], lastSync: "" };
  const usageData: UsageData = {
    blocks: mergeBucketBlocks(existing.blocks, write.blocks),
    lastSync: new Date().toISOString(),
  };

  if (write.usageSnapshot) {
    usageData.usageSnapshot = write.usageSnapshot;
  } else if (existing.usageSnapshot) {
    usageData.usageSnapshot = existing.usageSnapshot;
  }

  await kv.put(key, JSON.stringify(usageData));
  return usageData;
}

export async function putLegacyUsageData(kv: KVNamespace, userId: string, write: UsageWrite): Promise<UsageData> {
  return putUsageData(kv, `usage:${userId}`, write);
}

export async function putDeviceUsageData(
  kv: KVNamespace,
  userId: string,
  deviceId: string,
  write: UsageWrite,
): Promise<UsageData> {
  return putUsageData(kv, `usage_device:${userId}:${deviceId}`, write);
}

export async function registerUserDevice(kv: KVNamespace, userId: string, deviceId: string): Promise<string[]> {
  const devices = (await kv.get<string[]>(`user_devices:${userId}`, "json")) || [];
  if (!devices.includes(deviceId)) {
    devices.push(deviceId);
    await kv.put(`user_devices:${userId}`, JSON.stringify(devices));
  }
  return devices;
}

async function getSingleUserUsageData(kv: KVNamespace, userId: string): Promise<UsageData | null> {
  const legacy = await kv.get<UsageData>(`usage:${userId}`, "json");
  const deviceIds = (await kv.get<string[]>(`user_devices:${userId}`, "json")) || [];
  const deviceUsages = await Promise.all(
    deviceIds.map((deviceId) => kv.get<UsageData>(`usage_device:${userId}:${deviceId}`, "json")),
  );
  const usageItems = [legacy, ...deviceUsages].filter((item): item is UsageData => item != null);

  if (usageItems.length === 0) return null;

  const blocks = usageItems.flatMap((item) => item.blocks).sort(
    (a, b) =>
      new Date(a.blockStart).getTime() - new Date(b.blockStart).getTime() ||
      (a.source ?? "claude").localeCompare(b.source ?? "claude"),
  );

  const merged: UsageData = {
    blocks,
    lastSync: latestIso(usageItems.map((item) => item.lastSync)),
  };
  const snapshot = latestSnapshot(usageItems.map((item) => item.usageSnapshot));
  if (snapshot) merged.usageSnapshot = snapshot;
  return merged;
}

export async function getMergedUsageData(kv: KVNamespace, userId: string): Promise<UsageData | null> {
  const userIds = await getMergedUserIds(kv, userId);
  const usageItems = (await Promise.all(userIds.map((id) => getSingleUserUsageData(kv, id))))
    .filter((item): item is UsageData => item != null);

  if (usageItems.length === 0) return null;

  const blocks = usageItems.flatMap((item) => item.blocks).sort(
    (a, b) =>
      new Date(a.blockStart).getTime() - new Date(b.blockStart).getTime() ||
      (a.source ?? "claude").localeCompare(b.source ?? "claude"),
  );

  const merged: UsageData = {
    blocks,
    lastSync: latestIso(usageItems.map((item) => item.lastSync)),
  };
  const snapshot = latestSnapshot(usageItems.map((item) => item.usageSnapshot));
  if (snapshot) merged.usageSnapshot = snapshot;
  return merged;
}
