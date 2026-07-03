import { describe, expect, it } from "vitest";
import type { UsageBlock, UsageData } from "@ccclub/shared";
import {
  getMergedUsageData,
  putDeviceUsageData,
  putLegacyUsageData,
} from "../usage-store.js";

class MemoryKV {
  private values = new Map<string, string>();

  async get<T = unknown>(key: string, type?: "json" | "text"): Promise<T | string | null> {
    const value = this.values.get(key);
    if (value == null) return null;
    if (type === "json") return JSON.parse(value) as T;
    return value;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

function block(
  source: UsageBlock["source"],
  blockStart: string,
  totalTokens: number,
  costUSD: number,
): UsageBlock {
  return {
    source,
    blockStart,
    blockEnd: new Date(new Date(blockStart).getTime() + 30 * 60 * 1000).toISOString(),
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens,
    costUSD,
    models: ["gpt-5"],
    entryCount: 1,
    chatCount: 1,
  };
}

describe("usage store", () => {
  it("merges legacy usage with all linked device usage without changing legacy data", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    const legacy: UsageData = {
      blocks: [block("codex", "2026-06-01T00:00:00.000Z", 100, 1)],
      lastSync: "2026-06-01T00:10:00.000Z",
    };

    await kv.put("usage:user-a", JSON.stringify(legacy));
    await kv.put("user_devices:user-a", JSON.stringify(["device-a", "device-b"]));
    await kv.put("usage_device:user-a:device-a", JSON.stringify({
      blocks: [block("codex", "2026-06-01T00:30:00.000Z", 50, 0.5)],
      lastSync: "2026-06-01T00:40:00.000Z",
    } satisfies UsageData));
    await kv.put("usage_device:user-a:device-b", JSON.stringify({
      blocks: [block("claude", "2026-06-01T01:00:00.000Z", 25, 0.25)],
      lastSync: "2026-06-01T01:10:00.000Z",
    } satisfies UsageData));

    const merged = await getMergedUsageData(kv, "user-a");

    expect(merged?.blocks.map((b) => `${b.source}:${b.blockStart}:${b.totalTokens}`)).toEqual([
      "codex:2026-06-01T00:00:00.000Z:100",
      "codex:2026-06-01T00:30:00.000Z:50",
      "claude:2026-06-01T01:00:00.000Z:25",
    ]);
    expect(merged?.lastSync).toBe("2026-06-01T01:10:00.000Z");
    expect(await kv.get<UsageData>("usage:user-a", "json")).toEqual(legacy);
  });

  it("stores device blocks per device and replaces only that device source window", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;
    await putDeviceUsageData(kv, "user-a", "device-a", {
      blocks: [
        block("codex", "2026-06-01T00:00:00.000Z", 100, 1),
        block("claude", "2026-06-01T00:00:00.000Z", 80, 0.8),
      ],
    });

    await putDeviceUsageData(kv, "user-a", "device-a", {
      blocks: [block("codex", "2026-06-01T00:00:00.000Z", 150, 1.5)],
    });

    const stored = await kv.get<UsageData>("usage_device:user-a:device-a", "json");

    expect(stored?.blocks.map((b) => `${b.source}:${b.blockStart}:${b.totalTokens}`).sort()).toEqual([
      "codex:2026-06-01T00:00:00.000Z:150",
      "claude:2026-06-01T00:00:00.000Z:80",
    ].sort());
  });

  it("keeps legacy sync writes on usage:{userId}", async () => {
    const kv = new MemoryKV() as unknown as KVNamespace;

    await putLegacyUsageData(kv, "user-a", {
      blocks: [block("codex", "2026-06-01T00:00:00.000Z", 100, 1)],
    });

    expect(await kv.get<UsageData>("usage:user-a", "json")).toMatchObject({
      blocks: [{ blockStart: "2026-06-01T00:00:00.000Z", totalTokens: 100 }],
    });
    expect(await kv.get("usage_device:user-a:device-a", "json")).toBeNull();
  });
});
