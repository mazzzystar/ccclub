import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A sync asks for the usage limits and scans the logs. Run side by side, the
// scan starved the request's abort timer: the scan blocks the event loop in
// stretches, the timer fires the moment the loop comes back, and a request
// answered seconds earlier is thrown away as timed out — after which the sync
// uploads the stale cache and reports success. So the order is the contract.

const home = vi.hoisted(() => ({ path: "" }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => home.path };
});

const calls = vi.hoisted(() => ({ order: [] as string[], recorded: [] as unknown[] }));
const LIMITS = vi.hoisted(() => ({
  state: "failed" as const,
  snapshot: null,
  failure: { reason: "request timed out after 8s" },
}));

vi.mock("../usage-limits.js", () => ({
  refreshUsageLimits: async () => {
    calls.order.push("limits:start");
    await new Promise((resolve) => setTimeout(resolve, 25));
    calls.order.push("limits:done");
    return LIMITS;
  },
  recordLimitsOutcome: async (result: unknown) => {
    calls.order.push("limits:recorded");
    calls.recorded.push(result);
  },
}));
vi.mock("../collector.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../collector.js")>();
  return {
    ...actual,
    collectUsageEntries: async () => {
      calls.order.push("scan");
      return { entries: [], humanTurns: [], sources: [], warnings: [] };
    },
  };
});

vi.mock("../sync-lock.js", () => ({ acquireSyncLock: async () => ({ release: async () => {} }) }));
vi.mock("../hook.js", () => ({ isHookInstalled: () => true, installHook: async () => true }));
vi.mock("../heartbeat.js", () => ({ isHeartbeatInstalled: () => true, installHeartbeat: async () => true }));
vi.mock("../statusline-install.js", () => ({ maybeAutoEnableStatusline: async () => {} }));
vi.mock("../statusline.js", () => ({ refreshRankCache: async () => {} }));
vi.mock("../scan-cache.js", () => ({ createScanCacheFactory: () => undefined }));
vi.mock("../pricing.js", async () => {
  const shared = await import("@ccclub/shared");
  return {
    loadPricing: async () => ({
      calculateCost: shared.createCostCalculator(shared.PRICING_SNAPSHOT),
      version: "test",
    }),
    refreshPricingCache: async () => {},
  };
});

const { saveConfig } = await import("../config.js");
const { doSync } = await import("../commands/sync.js");

beforeEach(async () => {
  home.path = await mkdtemp(join(tmpdir(), "ccclub-limits-order-"));
  calls.order.length = 0;
  calls.recorded.length = 0;
  await saveConfig({
    apiUrl: "https://ccclub.test",
    token: "device-token",
    userId: "u1",
    displayName: "Tester",
    groups: ["ABC123"],
  });
});

afterEach(async () => {
  await rm(home.path, { recursive: true, force: true });
});

describe("sync and the usage limits", () => {
  it("finishes the limits request before the log scan starts", async () => {
    await doSync(false, true);
    expect(calls.order).toEqual(["limits:start", "limits:done", "limits:recorded", "scan"]);
  });

  it("hands a failed request to the recorder instead of dropping it", async () => {
    // --silent included: that is the run nobody is watching.
    await doSync(false, true);
    expect(calls.recorded).toEqual([LIMITS]);
  });
});
