import { mkdtemp, rm, writeFile, readFile, mkdir, utimes } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import { parseModelWeekly, writeModelWeekly, isTokenExpired, readCostlineFallback } from "../usage-limits.js";

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

describe("isTokenExpired", () => {
  const NOW = new Date("2026-08-05T10:00:00Z").getTime();

  it("compares epoch-millisecond expiries correctly", () => {
    // The previous check divided now by 1000 against a ms value, so it never
    // fired — these are the exact shapes from Claude Code's keychain entry.
    expect(isTokenExpired(NOW - 60_000, NOW)).toBe(true);
    expect(isTokenExpired(NOW + 60_000, NOW)).toBe(false);
  });

  it("tolerates an expiry expressed in seconds", () => {
    expect(isTokenExpired(Math.floor((NOW - 60_000) / 1000), NOW)).toBe(true);
    expect(isTokenExpired(Math.floor((NOW + 60_000) / 1000), NOW)).toBe(false);
  });

  it("treats a missing or malformed expiry as not expired", () => {
    for (const bad of [undefined, null, "soon", NaN, Infinity, 0, -5]) {
      expect(isTokenExpired(bad, NOW)).toBe(false);
    }
  });
});

describe("readCostlineFallback", () => {
  const NOW = new Date("2026-08-05T10:00:00Z").getTime();

  async function writeTmpFile(dir: string, body: string, mtimeMs: number): Promise<string> {
    const path = join(dir, "sl-claude-usage");
    await writeFile(path, body);
    await utimes(path, new Date(mtimeMs), new Date(mtimeMs));
    return path;
  }

  it("returns the values with the file's mtime as the honest fetch time", async () => {
    const mtime = NOW - 10 * 60_000;
    const path = await writeTmpFile(await makeTempDir(), JSON.stringify({ fiveHour: 42, sevenDay: 7 }), mtime);

    const result = readCostlineFallback(path, NOW);
    expect(result?.snapshot.fiveHour).toBe(42);
    expect(result?.snapshot.sevenDay).toBe(7);
    // Restamping with "now" would launder stale numbers into fresh-looking data.
    expect(result?.fetchedAt).toBe(mtime);
  });

  it("rejects a file older than the statusline's freshness bound", async () => {
    const path = await writeTmpFile(
      await makeTempDir(),
      JSON.stringify({ fiveHour: 42, sevenDay: 7 }),
      NOW - 4 * 60 * 60 * 1000,
    );
    expect(readCostlineFallback(path, NOW)).toBeNull();
  });

  it("rejects a future-dated file", async () => {
    const path = await writeTmpFile(
      await makeTempDir(),
      JSON.stringify({ fiveHour: 42, sevenDay: 7 }),
      NOW + 60 * 60 * 1000,
    );
    expect(readCostlineFallback(path, NOW)).toBeNull();
  });

  it("rejects anything that is not a small regular file", async () => {
    const dir = await makeTempDir();
    // A directory stands in for the general non-regular-file case (a planted
    // FIFO would block readFileSync forever — the lstat gate runs first).
    await mkdir(join(dir, "a-directory"));
    expect(readCostlineFallback(join(dir, "a-directory"), NOW)).toBeNull();
    expect(readCostlineFallback(join(dir, "missing"), NOW)).toBeNull();

    const big = await writeTmpFile(dir, JSON.stringify({ fiveHour: 1, sevenDay: 1 }).padEnd(5000, " "), NOW - 1000);
    expect(readCostlineFallback(big, NOW)).toBeNull();
  });

  it("rejects malformed or non-numeric contents", async () => {
    const dir = await makeTempDir();
    for (const body of ["nonsense", "{}", JSON.stringify({ fiveHour: "42", sevenDay: 7 }), JSON.stringify({ fiveHour: NaN })]) {
      const path = await writeTmpFile(dir, body, NOW - 1000);
      expect(readCostlineFallback(path, NOW)).toBeNull();
    }
  });
});
