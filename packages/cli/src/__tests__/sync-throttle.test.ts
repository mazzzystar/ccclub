import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `ccclub sync --silent` writes a 5-minute throttle stamp that silences the
// Stop hook. What this covers is *when*: a run that never got the sync lock
// did no work, and must not spend another process's five minutes.

const home = vi.hoisted(() => ({ path: "" }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => home.path };
});

const lock = vi.hoisted(() => ({ available: true, acquired: 0 }));
vi.mock("../sync-lock.js", () => ({
  acquireSyncLock: async () => {
    if (!lock.available) return null;
    lock.acquired++;
    return { release: async () => {} };
  },
}));

vi.mock("../hook.js", () => ({ isHookInstalled: () => true, installHook: async () => true }));
vi.mock("../heartbeat.js", () => ({ isHeartbeatInstalled: () => true, installHeartbeat: async () => true }));
vi.mock("../statusline-install.js", () => ({ maybeAutoEnableStatusline: async () => {} }));
vi.mock("../statusline.js", () => ({ refreshRankCache: async () => {} }));
vi.mock("../usage-limits.js", () => ({ fetchUsageLimits: async () => null }));
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
const { syncCommand } = await import("../commands/sync.js");

const BASE_CONFIG = {
  apiUrl: "https://ccclub.test",
  token: "device-token",
  userId: "u1",
  displayName: "Tester",
  groups: ["ABC123"],
};

let uploads = 0;

function stubFetch(syncOk = true): void {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    if (String(input).endsWith("/api/sync")) {
      uploads++;
      return syncOk
        ? { ok: true, status: 200, json: async () => ({ synced: 1 }) } as unknown as Response
        : { ok: false, status: 500, json: async () => ({ error: "boom" }) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }));
}

function stampPath(): string {
  return join(home.path, ".ccclub", "last-sync-time");
}

/** One Claude usage record, so a run has something to upload. */
async function writeClaudeUsage(): Promise<void> {
  const projects = join(home.path, ".claude", "projects");
  await mkdir(projects, { recursive: true });
  await writeFile(join(projects, "session.jsonl"), JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-01T00:00:01.000Z",
    sessionId: "s1",
    requestId: "r1",
    message: {
      id: "m1",
      model: "claude-sonnet-4-5-20250929",
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }));
}

beforeEach(async () => {
  home.path = await mkdtemp(join(tmpdir(), "ccclub-throttle-"));
  uploads = 0;
  lock.available = true;
  lock.acquired = 0;
  stubFetch();
  // The developer's own agent homes must stay out of this run.
  for (const env of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "OPENCODE_DATA_DIR", "AMP_DATA_DIR", "PI_AGENT_DIR", "GROK_HOME", "CCCLUB_SOURCES"]) {
    vi.stubEnv(env, "");
  }
  await saveConfig(BASE_CONFIG);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(home.path, { recursive: true, force: true });
});

describe("silent sync throttle stamp", () => {
  it("leaves the stamp untouched when another process holds the lock", async () => {
    // The bug: the stamp went down before doSync, so a hook run that lost the
    // lock still bought five minutes of silence — and after a long sleep those
    // five-minute windows are exactly when the caches need refreshing.
    await writeClaudeUsage();
    lock.available = false;

    await syncCommand({ silent: true });

    expect(existsSync(stampPath())).toBe(false);
    expect(uploads).toBe(0);
  });

  it("writes the stamp once a run completes, even with nothing to upload", async () => {
    // No usage data: performSync returns before its own stamp, so anything
    // found here was written by syncCommand after doSync came back.
    const before = Date.now();
    await syncCommand({ silent: true });

    expect(lock.acquired).toBe(1);
    expect(uploads).toBe(0);
    const stamp = parseInt(await readFile(stampPath(), "utf-8"), 10);
    expect(stamp).toBeGreaterThanOrEqual(before);
    expect(stamp).toBeLessThanOrEqual(Date.now());
  });

  it("then throttles the next silent run for five minutes", async () => {
    await syncCommand({ silent: true });
    const stamp = await readFile(stampPath(), "utf-8");

    await syncCommand({ silent: true });

    expect(lock.acquired).toBe(1); // the second run never reached the lock
    expect(await readFile(stampPath(), "utf-8")).toBe(stamp);
  });

  it("clears the stamp when the sync fails, so the next hook retries at once", async () => {
    await writeClaudeUsage();
    stubFetch(false);

    await syncCommand({ silent: true });

    expect(uploads).toBe(1);
    expect(await readFile(stampPath(), "utf-8")).toBe("0");
  });

  it("does not stamp for an interactive run", async () => {
    // The throttle exists for the hook; a person typing `ccclub sync` must not
    // silence it.
    await syncCommand({});
    expect(lock.acquired).toBe(1);
    expect(existsSync(stampPath())).toBe(false);
  });
});
