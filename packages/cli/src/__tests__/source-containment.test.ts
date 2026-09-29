import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it, expect, vi } from "vitest";

// The source-level catch is the last line of defence: whatever it swallows
// costs the source everything, and a --silent sync then exits 0. Its warning
// therefore has to name the source and say plainly that nothing from it was
// counted — the old wording read like a note about a single file.
vi.mock("../sources/claude.js", () => ({
  claudeCollector: {
    source: "claude",
    label: "Claude",
    collect: async () => { throw new Error("EACCES: permission denied, open '/x.jsonl'"); },
  },
}));

const { collectAllUsageEntries } = await import("../sources/index.js");

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("a collector that throws", () => {
  it("says the whole source was dropped, and names it and the cause", async () => {
    const result = await collectAllUsageEntries({ sources: ["claude"] });

    expect(result.entries).toEqual([]);
    expect(result.sources[0]).toMatchObject({ source: "claude", files: 0 });
    expect(result.warnings).toEqual([
      "Claude: collection failed, so NO Claude usage was counted in this run (EACCES: permission denied, open '/x.jsonl')",
    ]);
  });

  it("leaves the other sources' collection untouched", async () => {
    // An empty CODEX_HOME, so this reads a scratch directory and not whatever
    // the machine running the suite happens to have.
    const codexHome = await mkdtemp(join(tmpdir(), "ccclub-containment-"));
    tempDirs.push(codexHome);
    vi.stubEnv("CODEX_HOME", codexHome);

    const result = await collectAllUsageEntries({ sources: ["claude", "codex"] });

    expect(result.warnings).toHaveLength(1);
    expect(result.sources.map((source) => source.source)).toEqual(["claude", "codex"]);
  });
});
