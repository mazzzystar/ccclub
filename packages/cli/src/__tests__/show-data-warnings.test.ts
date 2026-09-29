import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `ccclub show-data` is where a user goes to see what is about to be uploaded.
// It used to print collector warnings only when it found nothing at all —
// precisely the case they would already have noticed — so a source that lost
// some of its files showed a healthy table and said nothing.

const home = vi.hoisted(() => ({ path: "" }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => home.path };
});

vi.mock("../sync-lock.js", () => ({
  acquireSyncLock: async () => ({ release: async () => {} }),
}));
vi.mock("../scan-cache.js", () => ({ createScanCacheFactory: () => undefined }));

const { showDataCommand } = await import("../commands/show-data.js");

let output: string[] = [];

beforeEach(async () => {
  home.path = await mkdtemp(join(tmpdir(), "ccclub-showdata-"));
  output = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  });
  for (const env of ["CODEX_HOME", "OPENCODE_DATA_DIR", "AMP_DATA_DIR", "PI_AGENT_DIR", "GROK_HOME"]) {
    vi.stubEnv(env, "");
  }
  vi.stubEnv("CCCLUB_SOURCES", "claude");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(home.path, { recursive: true, force: true });
});

describe("show-data", () => {
  it("prints the skipped file alongside the usage it did find", async () => {
    const claudeHome = join(home.path, "claude-config");
    const projects = join(claudeHome, "projects", "-Users-me-proj");
    await mkdir(join(projects, "dead-session", "subagents"), { recursive: true });
    await writeFile(join(projects, "live.jsonl"), JSON.stringify({
      type: "assistant",
      timestamp: "2026-09-29T09:00:01.000Z",
      sessionId: "live-1",
      requestId: "req-live-1",
      message: {
        id: "msg-live-1",
        model: "claude-opus-4-6",
        usage: { input_tokens: 1200, output_tokens: 800 },
      },
    }));
    const dangling = join(projects, "dead-session", "subagents", "agent-1.jsonl");
    await symlink(join(claudeHome, "gone.jsonl"), dangling);
    vi.stubEnv("CLAUDE_CONFIG_DIR", claudeHome);

    await showDataCommand();
    const text = output.join("\n");

    expect(text).toContain("Total entries found: 1");
    expect(text).toContain("Warnings:");
    expect(text).toContain(dangling);
  });
});
