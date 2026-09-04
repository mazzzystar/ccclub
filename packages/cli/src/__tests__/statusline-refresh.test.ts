import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The statusline's self-heal: after printing, it may start a background sync.
// Nothing here may spawn a real process or reach the developer's own
// ~/.ccclub, so child_process and homedir are both replaced.

const { spawn, unref } = vi.hoisted(() => ({ spawn: vi.fn(), unref: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn };
});

const home = vi.hoisted(() => ({ path: "" }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => home.path };
});

const {
  REFRESH_DEBOUNCE_MS,
  REFRESH_MIN_AGE_MS,
  getRefreshStampPath,
  maybeTriggerRefresh,
  shouldTriggerRefresh,
} = await import("../statusline-refresh.js");

const NOW = new Date("2026-07-13T12:00:00").getTime();
const CLI_PATH = "/opt/ccclub/dist/index.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ccclub-refresh-"));
  tempDirs.push(dir);
  return dir;
}

beforeEach(async () => {
  home.path = await makeTempDir();
  spawn.mockReset();
  unref.mockReset();
  spawn.mockReturnValue({ unref });
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("shouldTriggerRefresh", () => {
  it("refreshes when the usage cache is missing or unreadable", () => {
    expect(shouldTriggerRefresh({ usageFetchedAt: null, lastSpawnAt: null, now: NOW })).toBe(true);
  });

  it("leaves a cache younger than ten minutes alone", () => {
    expect(shouldTriggerRefresh({
      usageFetchedAt: NOW - 9 * 60_000,
      lastSpawnAt: null,
      now: NOW,
    })).toBe(false);
  });

  it("refreshes once the cache passes ten minutes", () => {
    expect(shouldTriggerRefresh({
      usageFetchedAt: NOW - REFRESH_MIN_AGE_MS - 1,
      lastSpawnAt: null,
      now: NOW,
    })).toBe(true);
  });

  it("debounces repeated attempts for five minutes even while the sync keeps failing", () => {
    // Offline: the cache stays stale no matter how many syncs run, so the age
    // test alone would spawn a process on every single turn.
    const stale = { usageFetchedAt: NOW - 8 * 60 * 60 * 1000, now: NOW };
    expect(shouldTriggerRefresh({ ...stale, lastSpawnAt: NOW - 60_000 })).toBe(false);
    expect(shouldTriggerRefresh({ ...stale, lastSpawnAt: NOW - REFRESH_DEBOUNCE_MS - 1 })).toBe(true);
  });

  it("does not read a future-dated stamp or cache as fresh", () => {
    // A clock moved backwards must not silence the refresh forever.
    expect(shouldTriggerRefresh({
      usageFetchedAt: NOW - 8 * 60 * 60 * 1000,
      lastSpawnAt: NOW + 60 * 60_000,
      now: NOW,
    })).toBe(true);
    expect(shouldTriggerRefresh({
      usageFetchedAt: NOW + 60 * 60_000,
      lastSpawnAt: null,
      now: NOW,
    })).toBe(true);
  });
});

/** A usage cache of the given age, plus the paths maybeTriggerRefresh needs. */
async function setUp(ageMs: number | null): Promise<{ usageCachePath: string; stampPath: string }> {
  const dir = await makeTempDir();
  const usageCachePath = join(dir, "usage-cache.json");
  if (ageMs != null) {
    await writeFile(usageCachePath, JSON.stringify({
      snapshot: { fiveHour: 15, sevenDay: 43, snapshotAt: "x" },
      fetchedAt: NOW - ageMs,
    }));
  }
  return { usageCachePath, stampPath: join(dir, "statusline-refresh") };
}

describe("maybeTriggerRefresh", () => {
  it("spawns a detached, unref'd sync with this node and the neighbouring CLI", async () => {
    const paths = await setUp(4 * 60 * 60 * 1000);

    expect(maybeTriggerRefresh({ cliPath: CLI_PATH, now: NOW, ...paths })).toBe(true);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [CLI_PATH, "sync", "--silent"],
      { detached: true, stdio: "ignore" },
    );
    expect(unref).toHaveBeenCalledTimes(1);
    expect(existsSync(paths.stampPath)).toBe(true);
  });

  it("spawns when there is no usage cache at all", async () => {
    const paths = await setUp(null);
    expect(maybeTriggerRefresh({ cliPath: CLI_PATH, now: NOW, ...paths })).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("stays quiet while the cache is fresh", async () => {
    const paths = await setUp(60_000);
    expect(maybeTriggerRefresh({ cliPath: CLI_PATH, now: NOW, ...paths })).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    expect(existsSync(paths.stampPath)).toBe(false);
  });

  it("spawns at most once per debounce window, then again after it", async () => {
    const paths = await setUp(4 * 60 * 60 * 1000);

    expect(maybeTriggerRefresh({ cliPath: CLI_PATH, now: NOW, ...paths })).toBe(true);
    // The stamp's mtime is real time, so drive the clock instead of the file.
    const stampedAt = statSync(paths.stampPath).mtimeMs;
    expect(maybeTriggerRefresh({
      cliPath: CLI_PATH,
      now: stampedAt + REFRESH_DEBOUNCE_MS - 1_000,
      ...paths,
    })).toBe(false);
    expect(spawn).toHaveBeenCalledTimes(1);

    expect(maybeTriggerRefresh({
      cliPath: CLI_PATH,
      now: stampedAt + REFRESH_DEBOUNCE_MS + 1_000,
      ...paths,
    })).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("re-reads the debounce stamp another statusline left behind", async () => {
    const paths = await setUp(4 * 60 * 60 * 1000);
    await writeFile(paths.stampPath, "");
    const recent = new Date(NOW - 60_000);
    await utimes(paths.stampPath, recent, recent);

    expect(maybeTriggerRefresh({ cliPath: CLI_PATH, now: NOW, ...paths })).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("swallows a failing spawn, and still burns the debounce", async () => {
    // Mirrors what statusline-cli.ts relies on: the line is already on stdout,
    // so nothing here may throw, change the output, or fail the process.
    spawn.mockImplementation(() => { throw new Error("EAGAIN: cannot fork"); });
    const paths = await setUp(4 * 60 * 60 * 1000);

    let result: boolean | undefined;
    expect(() => { result = maybeTriggerRefresh({ cliPath: CLI_PATH, now: NOW, ...paths }); }).not.toThrow();
    expect(result).toBe(false);
    expect(existsSync(paths.stampPath)).toBe(true);
    const stampedAt = statSync(paths.stampPath).mtimeMs;
    expect(maybeTriggerRefresh({ cliPath: CLI_PATH, now: stampedAt + 1_000, ...paths })).toBe(false);
    expect(spawn).toHaveBeenCalledTimes(1); // not retried every turn
  });

  it("defaults the stamp to ~/.ccclub without needing the directory to exist", () => {
    expect(getRefreshStampPath()).toBe(join(home.path, ".ccclub", "statusline-refresh"));
    // No config dir yet — the first run must create it rather than give up.
    expect(maybeTriggerRefresh({
      cliPath: CLI_PATH,
      now: NOW,
      usageCachePath: join(home.path, ".ccclub", "usage-cache.json"),
    })).toBe(true);
    expect(existsSync(getRefreshStampPath())).toBe(true);
  });
});
