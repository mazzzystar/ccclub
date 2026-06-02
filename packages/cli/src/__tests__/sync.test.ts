import { describe, expect, it } from "vitest";
import type { UsageBlock } from "@ccclub/shared";
import { createSyncRequest } from "../commands/sync.js";

const blocks: UsageBlock[] = [{
  source: "codex",
  blockStart: "2026-06-01T00:00:00.000Z",
  blockEnd: "2026-06-01T00:30:00.000Z",
  inputTokens: 100,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 100,
  costUSD: 1,
  models: ["gpt-5"],
  entryCount: 1,
  chatCount: 1,
}];

describe("sync request body", () => {
  it("keeps legacy sync bodies unchanged when config has no deviceId", () => {
    expect(createSyncRequest(blocks, null, undefined)).toEqual({ blocks });
  });

  it("includes deviceId only for device-aware configs", () => {
    expect(createSyncRequest(blocks, null, "device-a")).toEqual({
      blocks,
      deviceId: "device-a",
    });
  });
});
