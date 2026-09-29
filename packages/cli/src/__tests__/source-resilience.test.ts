import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach, vi } from "vitest";
import { collectUsageEntries } from "../collector.js";

// One unreadable file used to cost an entire source. `globFiles` returns paths
// that no longer resolve — above all the dangling `subagents/*.jsonl` symlinks
// Claude Code leaves behind when it deletes a session directory — and the
// ENOENT thrown while opening one escaped the collector, where
// collectAllUsageEntries turned it into an empty result for every file that
// source had. Silent syncs drop the warning and exit 0, so a whole day of
// usage could go unuploaded without a word.

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ccclub-resilience-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const CLAUDE_RECORD = JSON.stringify({
  type: "assistant",
  timestamp: "2026-09-29T00:00:01.000Z",
  sessionId: "session-live",
  requestId: "req-live",
  message: {
    id: "msg-live",
    model: "claude-opus-4-6",
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 },
  },
});

describe("collectors survive files that cannot be read", () => {
  it("counts the readable Claude logs and warns about a dangling subagent symlink", async () => {
    const claudeHome = await makeTempDir();
    const projectsDir = join(claudeHome, "projects", "-Users-me-proj");
    const deadSubagents = join(projectsDir, "deleted-session", "subagents");
    await mkdir(deadSubagents, { recursive: true });
    await writeFile(join(projectsDir, "live-session.jsonl"), CLAUDE_RECORD);
    // The exact shape found on the maintainer's Mac: the session directory is
    // gone, its subagent links are not.
    const dangling = join(deadSubagents, "agent-1.jsonl");
    await symlink(join(claudeHome, "gone", "agent-1.jsonl"), dangling);
    vi.stubEnv("CLAUDE_CONFIG_DIR", claudeHome);

    const result = await collectUsageEntries({ sources: ["claude"] });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].inputTokens).toBe(10);
    // Only the file that was actually read counts; `files` drives the
    // replaceSources decision on a full sync.
    expect(result.sources[0].files).toBe(1);
    expect(result.sources[0].warnings).toHaveLength(1);
    expect(result.sources[0].warnings[0]).toContain(dangling);
    expect(result.warnings[0]).toMatch(/^Claude: skipped 1 unreadable file/);
  });

  it("names three dangling Claude links and counts the rest", async () => {
    const claudeHome = await makeTempDir();
    const projectsDir = join(claudeHome, "projects");
    await mkdir(projectsDir, { recursive: true });
    await writeFile(join(projectsDir, "live.jsonl"), CLAUDE_RECORD);
    for (let i = 0; i < 5; i++) {
      await symlink(join(claudeHome, "gone", `a${i}.jsonl`), join(projectsDir, `dead-${i}.jsonl`));
    }
    vi.stubEnv("CLAUDE_CONFIG_DIR", claudeHome);

    const result = await collectUsageEntries({ sources: ["claude"] });

    expect(result.entries).toHaveLength(1);
    expect(result.sources[0].files).toBe(1);
    expect(result.warnings[0]).toContain("skipped 5 unreadable files");
    expect(result.warnings[0]).toContain("and 2 more");
  });

  it("keeps Codex rollouts when one session file is a dangling symlink", async () => {
    const codexHome = await makeTempDir();
    const sessionsDir = join(codexHome, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, "session.jsonl"), [
      JSON.stringify({
        timestamp: "2026-09-29T00:00:00.000Z",
        type: "turn_context",
        payload: { model: "gpt-5" },
      }),
      JSON.stringify({
        timestamp: "2026-09-29T00:00:01.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 25,
              output_tokens: 10,
              total_tokens: 110,
            },
          },
        },
      }),
    ].join("\n"));
    const dangling = join(sessionsDir, "rotated.jsonl");
    await symlink(join(codexHome, "gone.jsonl"), dangling);
    vi.stubEnv("CODEX_HOME", codexHome);

    const result = await collectUsageEntries({ sources: ["codex"] });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].totalTokens).toBe(110);
    expect(result.sources[0].warnings[0]).toContain(dangling);
  });

  it("keeps Amp threads when one thread file is a dangling symlink", async () => {
    const ampHome = await makeTempDir();
    const threadsDir = join(ampHome, "threads");
    await mkdir(threadsDir, { recursive: true });
    await writeFile(join(threadsDir, "T-live.json"), JSON.stringify({
      id: "T-live",
      messages: [],
      usageLedger: {
        events: [{
          timestamp: "2026-09-29T00:00:01.000Z",
          model: "claude-opus-4-6",
          tokens: { input: 20, output: 7 },
          toMessageId: 0,
        }],
      },
    }));
    const dangling = join(threadsDir, "T-dead.json");
    await symlink(join(ampHome, "gone.json"), dangling);
    vi.stubEnv("AMP_DATA_DIR", ampHome);

    const result = await collectUsageEntries({ sources: ["amp"] });

    expect(result.sources[0].files).toBe(1);
    expect(result.sources[0].warnings[0]).toContain(dangling);
  });
});
