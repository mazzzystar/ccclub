import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SOURCES, PRICING_SNAPSHOT, createCostCalculator } from "@ccclub/shared";
import type { SyncRequest } from "@ccclub/shared";

// A whole `ccclub sync --silent` run — the exact code path the background
// LaunchAgent takes — with only its side effects stubbed. What it must prove
// is that the source set on the wire comes from ~/.ccclub/config.json.

const { cursorCollect } = vi.hoisted(() => ({ cursorCollect: vi.fn() }));
vi.mock("../sources/cursor.js", () => ({
  cursorCollector: { source: "cursor", label: "Cursor", collect: cursorCollect },
}));

const home = vi.hoisted(() => ({ path: "" }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => home.path };
});

vi.mock("../hook.js", () => ({ isHookInstalled: () => true, installHook: async () => true }));
vi.mock("../heartbeat.js", () => ({ isHeartbeatInstalled: () => true, installHeartbeat: async () => true }));
vi.mock("../statusline-install.js", () => ({ maybeAutoEnableStatusline: async () => {} }));
vi.mock("../statusline.js", () => ({ refreshRankCache: async () => {} }));
vi.mock("../usage-limits.js", () => ({ fetchUsageLimits: async () => null }));
vi.mock("../sync-lock.js", () => ({ acquireSyncLock: async () => ({ release: async () => {} }) }));
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

const BASE_CONFIG = {
  apiUrl: "https://ccclub.test",
  token: "device-token",
  userId: "u1",
  displayName: "Tester",
  groups: ["ABC123"],
};

let uploads: SyncRequest[] = [];
let fetched: string[] = [];

function stubFetch(): void {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    fetched.push(url);
    if (url.endsWith("/api/sync")) {
      uploads.push(JSON.parse(String(init?.body)) as SyncRequest);
      return { ok: true, status: 200, json: async () => ({ synced: 1 }) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }));
}

/** One real Claude usage record, so the run has something to upload. */
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

beforeAll(() => {
  // Pinning the cost table keeps this test about source selection only.
  expect(createCostCalculator(PRICING_SNAPSHOT)).toBeTypeOf("function");
});

beforeEach(async () => {
  home.path = await mkdtemp(join(tmpdir(), "ccclub-sync-"));
  uploads = [];
  fetched = [];
  cursorCollect.mockReset();
  cursorCollect.mockResolvedValue({ source: "cursor", entries: [], turns: [], files: 0, warnings: [] });
  stubFetch();
  // The developer's own agent homes must stay out of this run.
  for (const env of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "OPENCODE_DATA_DIR", "AMP_DATA_DIR", "PI_AGENT_DIR", "GROK_HOME", "CCCLUB_SOURCES"]) {
    vi.stubEnv(env, "");
  }
  await writeClaudeUsage();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(home.path, { recursive: true, force: true });
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("sync source reporting", () => {
  it("tracks only the defaults and never touches Cursor for a plain user", async () => {
    await saveConfig(BASE_CONFIG);

    await doSync(false, true);

    expect(uploads).toHaveLength(1);
    expect(uploads[0].trackedSources).toEqual([...DEFAULT_SOURCES]);
    expect(uploads[0].trackedSources).not.toContain("cursor");
    expect(cursorCollect).not.toHaveBeenCalled();
    expect(fetched.some((url) => url.includes("cursor"))).toBe(false);
  });

  it("tracks and collects Cursor once the config enables it", async () => {
    await saveConfig({ ...BASE_CONFIG, enabledSources: ["cursor"] });

    await doSync(false, true);

    expect(uploads).toHaveLength(1);
    expect(uploads[0].trackedSources).toEqual([...DEFAULT_SOURCES, "cursor"]);
    expect(cursorCollect).toHaveBeenCalledTimes(1);
  });

  it("lets CCCLUB_SOURCES narrow one run without narrowing what is tracked", async () => {
    await saveConfig({ ...BASE_CONFIG, enabledSources: ["cursor"] });
    vi.stubEnv("CCCLUB_SOURCES", "claude");

    await doSync(false, true);

    expect(uploads[0].trackedSources).toEqual([...DEFAULT_SOURCES, "cursor"]);
    expect(cursorCollect).not.toHaveBeenCalled();
  });
});
