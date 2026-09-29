import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A --silent sync (Stop hook, LaunchAgent) prints nothing and exits 0, so a
// source that silently collected nothing left no trace anywhere. These runs
// now write their collector warnings to ~/.ccclub/sync.log.

const home = vi.hoisted(() => ({ path: "" }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => home.path };
});

vi.mock("../sync-lock.js", () => ({
  acquireSyncLock: async () => ({ release: async () => {} }),
}));
vi.mock("../hook.js", () => ({
  isHookInstalled: () => true,
  installHook: async () => true,
  newerPinnedHookVersion: () => null,
}));
vi.mock("../heartbeat.js", () => ({
  isHeartbeatInstalled: () => true,
  installHeartbeat: async () => true,
  newerPinnedHeartbeatVersion: () => null,
}));
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
const { doSync } = await import("../commands/sync.js");
const { appendCappedLog } = await import("../fs-utils.js");

const BASE_CONFIG = {
  apiUrl: "https://ccclub.test",
  token: "device-token",
  userId: "u1",
  displayName: "Tester",
  groups: ["ABC123"],
};

function syncLogPath(): string {
  return join(home.path, ".ccclub", "sync.log");
}

/** A readable session plus the dangling subagent link that used to kill it. */
async function writeClaudeProjects(): Promise<string> {
  const projects = join(home.path, ".claude", "projects", "-Users-me-proj");
  await mkdir(join(projects, "dead-session", "subagents"), { recursive: true });
  await writeFile(join(projects, "live.jsonl"), JSON.stringify({
    type: "assistant",
    timestamp: "2026-09-29T00:00:01.000Z",
    sessionId: "s1",
    requestId: "r1",
    message: {
      id: "m1",
      model: "claude-sonnet-4-5-20250929",
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  }));
  const dangling = join(projects, "dead-session", "subagents", "agent-1.jsonl");
  await symlink(join(home.path, "gone.jsonl"), dangling);
  return dangling;
}

beforeEach(async () => {
  home.path = await mkdtemp(join(tmpdir(), "ccclub-synclog-"));
  vi.stubGlobal("fetch", vi.fn(async () => (
    { ok: true, status: 200, json: async () => ({ synced: 1 }) } as unknown as Response
  )));
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

describe("silent sync warning log", () => {
  it("records each collector warning with a timestamp", async () => {
    const dangling = await writeClaudeProjects();

    await doSync(false, true);

    const lines = (await readFile(syncLogPath(), "utf-8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z Claude: skipped 1 unreadable file/);
    expect(lines[0]).toContain(dangling);
  });

  it("appends across runs and writes nothing when there is nothing to say", async () => {
    await doSync(false, true);
    expect(existsSync(syncLogPath())).toBe(false);

    await writeClaudeProjects();
    await doSync(false, true);
    await doSync(false, true);

    expect((await readFile(syncLogPath(), "utf-8")).trim().split("\n")).toHaveLength(2);
  });

  it("leaves an interactive run's warnings on the console only", async () => {
    await writeClaudeProjects();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await doSync(false, false);

    expect(existsSync(syncLogPath())).toBe(false);
  });

  it("rotates one generation at the cap instead of growing forever", async () => {
    const path = join(home.path, ".ccclub", "sync.log");
    await appendCappedLog(path, "old\n", 64);
    await appendCappedLog(path, `${"x".repeat(70)}\n`, 64);

    // The oversized write starts a fresh file and the previous one is kept as
    // exactly one generation back.
    expect(await readFile(`${path}.1`, "utf-8")).toBe("old\n");
    expect((await readFile(path, "utf-8")).length).toBe(71);
  });
});
