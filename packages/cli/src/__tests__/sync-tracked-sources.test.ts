import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

/** What the mocked collector hands back: one Cursor entry in one block. */
function cursorCollection(timestamp: string, extra: Record<string, unknown> = {}) {
  return {
    source: "cursor" as const,
    entries: [{
      source: "cursor" as const,
      timestamp,
      sessionId: "conv-1",
      requestId: `cursor:${timestamp}`,
      model: "claude-fable-5-thinking-high",
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 15,
      costUSD: 0.01,
    }],
    turns: [{ source: "cursor" as const, timestamp, key: "cursor:conv-1" }],
    files: 1,
    warnings: [],
    ...extra,
  };
}

async function readSourceMarkers(): Promise<Partial<Record<string, string>>> {
  return JSON.parse(await readFile(join(home.path, ".ccclub", "last-sync-sources.json"), "utf-8"));
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
    // Spelled out, not `[...DEFAULT_SOURCES]`: the point of the assertion is
    // that adding a source to that constant cannot silently start shipping it
    // as tracked from a plain user's machine.
    expect(uploads[0].trackedSources).toEqual(["claude", "codex", "opencode", "amp", "pi", "grok"]);
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

  it("keeps a Cursor that read nothing out of a full sync's replaceSources", async () => {
    // replaceSources deletes the server's stored history for a source. A
    // collector that reported files: 0 — expired login, reshaped API, no
    // token — has not proven anything about that history and must not be
    // allowed to wipe it.
    await saveConfig({ ...BASE_CONFIG, enabledSources: ["cursor"] });

    await doSync(true, true);

    expect(cursorCollect).toHaveBeenCalledTimes(1);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].replaceSources).toContain("claude");
    expect(uploads[0].replaceSources).not.toContain("cursor");
  });

  it("holds Cursor's sync marker when the collector truncated its window", async () => {
    // Advancing to the newest block after a partial read would put the blocks
    // that read never reached below the watermark, where filterBlocksToSync
    // drops them forever. Holding the marker makes the next run ask again.
    await saveConfig({ ...BASE_CONFIG, enabledSources: ["cursor"] });

    cursorCollect.mockResolvedValue(cursorCollection("2026-08-01T00:00:00.000Z"));
    await doSync(false, true);
    const first = await readSourceMarkers();
    expect(first.cursor).toBe("2026-08-01T00:00:00.000Z");

    cursorCollect.mockResolvedValue(
      cursorCollection("2026-08-02T00:00:00.000Z", { truncated: true }),
    );
    await doSync(false, true);
    const second = await readSourceMarkers();

    expect(second.cursor).toBe("2026-08-01T00:00:00.000Z");
    // Only the truncated source is held back; the rest still advance.
    expect(second.claude).toBe(first.claude);
  });
});
