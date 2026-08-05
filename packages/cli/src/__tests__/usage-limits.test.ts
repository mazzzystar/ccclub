import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import { parseModelWeekly, writeModelWeekly } from "../usage-limits.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ccclub-ul-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Shape of the real /api/oauth/usage limits[] array. */
const SCOPED = {
  kind: "weekly_scoped",
  percent: 21,
  scope: { model: { id: null, display_name: "Fable" } },
};
const UNSCOPED = [
  { kind: "session", percent: 18, scope: null },
  { kind: "weekly_all", percent: 12, scope: null },
];

describe("parseModelWeekly", () => {
  it("finds the scoped entry among the unscoped ones", () => {
    expect(parseModelWeekly([...UNSCOPED, SCOPED])).toEqual({
      state: "found",
      limit: { label: "Fable", percent: 21 },
    });
  });

  it("accepts a percent sent as a string, as the API does elsewhere", () => {
    expect(parseModelWeekly([{ ...SCOPED, percent: "21.5%" }])).toEqual({
      state: "found",
      limit: { label: "Fable", percent: 21.5 },
    });
  });

  it("reports 'none' only when no scoped entry exists at all", () => {
    expect(parseModelWeekly(UNSCOPED)).toEqual({ state: "none" });
    expect(parseModelWeekly([])).toEqual({ state: "none" });
  });

  it("reports 'unknown' when a scoped entry exists but cannot be read", () => {
    // A schema drift must not be mistaken for "the limit was lifted".
    for (const broken of [
      { kind: "weekly_scoped", percent: 21, scope: null },
      { kind: "weekly_scoped", percent: 21, scope: { model: { display_name: "" } } },
      { kind: "weekly_scoped", percent: "n/a", scope: { model: { display_name: "Fable" } } },
      { kind: "weekly_scoped", scope: { model: { display_name: "Fable" } } },
    ]) {
      expect(parseModelWeekly([...UNSCOPED, broken])).toEqual({ state: "unknown" });
    }
  });

  it("reports 'unknown' when limits[] is missing or not an array", () => {
    for (const bad of [undefined, null, {}, "limits"]) {
      expect(parseModelWeekly(bad)).toEqual({ state: "unknown" });
    }
  });
});

describe("writeModelWeekly", () => {
  async function read(path: string) {
    return JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
  }

  it("records a found limit with a timestamp", async () => {
    const path = join(await makeTempDir(), "model-weekly.json");

    writeModelWeekly({ state: "found", limit: { label: "Fable", percent: 21 } }, path);

    const stored = await read(path);
    expect(stored.label).toBe("Fable");
    expect(stored.percent).toBe(21);
    expect(typeof stored.fetchedAt).toBe("number");
  });

  it("records an absent limit rather than deleting the file", async () => {
    // Keeping a timestamp is what lets a later run tell "checked, no limit"
    // apart from "never fetched" — the latter has to force a refresh.
    const path = join(await makeTempDir(), "model-weekly.json");
    writeModelWeekly({ state: "found", limit: { label: "Fable", percent: 21 } }, path);

    writeModelWeekly({ state: "none" }, path);

    const stored = await read(path);
    expect(stored.label).toBeUndefined();
    expect(stored.percent).toBeUndefined();
    expect(typeof stored.fetchedAt).toBe("number");
  });

  it("leaves an existing value untouched when the payload is unreadable", async () => {
    const path = join(await makeTempDir(), "model-weekly.json");
    writeModelWeekly({ state: "found", limit: { label: "Fable", percent: 21 } }, path);
    const before = await read(path);

    writeModelWeekly({ state: "unknown" }, path);

    expect(await read(path)).toEqual(before);
  });

  it("writes nothing at all when unknown and no file exists yet", async () => {
    const path = join(await makeTempDir(), "model-weekly.json");
    writeModelWeekly({ state: "unknown" }, path);
    expect(existsSync(path)).toBe(false);
  });

  it("leaves no temp file behind", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "model-weekly.json");

    writeModelWeekly({ state: "found", limit: { label: "Fable", percent: 21 } }, path);

    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("never leaves a partially written file for the statusline to read", async () => {
    // The swap is a rename, so any read either sees the old file or the new
    // one — never a truncated one.
    const dir = await makeTempDir();
    const path = join(dir, "model-weekly.json");
    await writeFile(path, JSON.stringify({ label: "Fable", percent: 8, fetchedAt: 1 }));

    for (let i = 0; i < 25; i++) {
      writeModelWeekly({ state: "found", limit: { label: "Fable", percent: i } }, path);
      expect(() => JSON.parse(readFileSync(path, "utf-8"))).not.toThrow();
    }
  });
});
