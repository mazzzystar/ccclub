import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
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
  LIMITS_MAX_BACKOFF_MS,
  LIMITS_MIN_AGE_MS,
  REFRESH_DEBOUNCE_MS,
  REFRESH_MIN_AGE_MS,
  getRefreshStampPath,
  maybeRefreshLimits,
  maybeTriggerRefresh,
  shouldRefreshLimits,
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

const HOUR_MS = 60 * 60 * 1000;
const LIMITS_CLI_PATH = "/opt/ccclub/dist/limits-cli.js";

/** A window resetting `resetsInMs` from NOW, as the policy sees it. */
function win(percent: number, resetsInMs = HOUR_MS): { percent: number; resetsAt: number } {
  return { percent, resetsAt: NOW + resetsInMs };
}

const NO_FAILURES = { failures: 0 };

describe("shouldRefreshLimits", () => {
  const ahead = { fiveHour: win(97), sevenDay: null, cacheFetchedAt: NOW - 3 * 60_000 };

  it("stays quiet while no session is ahead of the cache", () => {
    // The common render, and every idle machine: nothing moved, nothing asked.
    expect(shouldRefreshLimits({
      lead: { fiveHour: null, sevenDay: null, cacheFetchedAt: NOW - 8 * HOUR_MS },
      attempt: null,
      state: NO_FAILURES,
      now: NOW,
    })).toBe(false);
  });

  it("refreshes when a session has seen usage the cache has not", () => {
    expect(shouldRefreshLimits({ lead: ahead, attempt: null, state: NO_FAILURES, now: NOW })).toBe(true);
    // No cache at all is the same case.
    expect(shouldRefreshLimits({
      lead: { ...ahead, cacheFetchedAt: null },
      attempt: null,
      state: NO_FAILURES,
      now: NOW,
    })).toBe(true);
  });

  it("never refreshes a cache younger than a minute", () => {
    expect(shouldRefreshLimits({
      lead: { ...ahead, cacheFetchedAt: NOW - LIMITS_MIN_AGE_MS + 1_000 },
      attempt: null,
      state: NO_FAILURES,
      now: NOW,
    })).toBe(false);
  });

  it("starts at most one attempt a minute, however fast the number moves", () => {
    const attempt = { at: NOW - 30_000, fiveHour: win(95), sevenDay: null };
    expect(shouldRefreshLimits({ lead: ahead, attempt, state: NO_FAILURES, now: NOW })).toBe(false);
    expect(shouldRefreshLimits({
      lead: ahead,
      attempt: { ...attempt, at: NOW - LIMITS_MIN_AGE_MS - 1 },
      state: NO_FAILURES,
      now: NOW,
    })).toBe(true);
  });

  it("does not ask again for a number it already asked about", () => {
    // The request succeeded and the session is still ahead: the endpoint and
    // the headers Claude Code reads disagree by a point. Without this, an open
    // session would poll once a minute until it closed.
    const attempt = { at: NOW - 10 * 60_000, fiveHour: win(97), sevenDay: null };
    expect(shouldRefreshLimits({ lead: ahead, attempt, state: NO_FAILURES, now: NOW })).toBe(false);
    // An idle session still reporting an older, lower number is not news either.
    expect(shouldRefreshLimits({
      lead: { ...ahead, fiveHour: win(96) },
      attempt,
      state: NO_FAILURES,
      now: NOW,
    })).toBe(false);
  });

  it("asks again once the number moves past the last one asked about", () => {
    const attempt = { at: NOW - 10 * 60_000, fiveHour: win(96), sevenDay: win(60, 6 * 24 * HOUR_MS) };
    expect(shouldRefreshLimits({ lead: ahead, attempt, state: NO_FAILURES, now: NOW })).toBe(true);
    // Either window counts.
    expect(shouldRefreshLimits({
      lead: { fiveHour: null, sevenDay: win(61, 6 * 24 * HOUR_MS), cacheFetchedAt: NOW - 3 * 60_000 },
      attempt,
      state: NO_FAILURES,
      now: NOW,
    })).toBe(true);
  });

  it("treats a new window as news even at a lower percentage", () => {
    const attempt = { at: NOW - 10 * 60_000, fiveHour: win(97, -4 * HOUR_MS), sevenDay: null };
    expect(shouldRefreshLimits({
      lead: { fiveHour: win(2, 4.9 * HOUR_MS), sevenDay: null, cacheFetchedAt: NOW - 3 * 60_000 },
      attempt,
      state: NO_FAILURES,
      now: NOW,
    })).toBe(true);
  });

  it("retries a failed attempt on a doubling wait, capped", () => {
    // Same number as the failed attempt was for: it is still owed.
    const failedFor = (failures: number, minutesAgo: number) => shouldRefreshLimits({
      lead: ahead,
      attempt: { at: NOW - minutesAgo * 60_000, fiveHour: win(97), sevenDay: null },
      state: { failures, reason: "request timed out after 15s" },
      now: NOW,
    });
    expect(failedFor(1, 1.5)).toBe(false); // waits 2 min after the first failure
    expect(failedFor(1, 2.5)).toBe(true);
    expect(failedFor(3, 7)).toBe(false); // 8 min after the third
    expect(failedFor(3, 9)).toBe(true);
    expect(failedFor(40, LIMITS_MAX_BACKOFF_MS / 60_000 - 1)).toBe(false);
    expect(failedFor(40, LIMITS_MAX_BACKOFF_MS / 60_000 + 1)).toBe(true); // never more than the cap
  });

  it("honors the server's Retry-After, within reason", () => {
    const attempt = { at: NOW - 20 * 60_000, fiveHour: win(97), sevenDay: null };
    expect(shouldRefreshLimits({
      lead: ahead,
      attempt,
      state: { failures: 1, retryAt: NOW + 5 * 60_000 },
      now: NOW,
    })).toBe(false);
    // A retryAt absurdly far out (clock moved, corrupt file) is not believed.
    expect(shouldRefreshLimits({
      lead: ahead,
      attempt,
      state: { failures: 1, retryAt: NOW + 48 * HOUR_MS },
      now: NOW,
    })).toBe(true);
  });

  it("does not read a future-dated attempt as recent", () => {
    expect(shouldRefreshLimits({
      lead: ahead,
      attempt: { at: NOW + HOUR_MS, fiveHour: win(90), sevenDay: null },
      state: NO_FAILURES,
      now: NOW,
    })).toBe(true);
  });
});

/** Stdin as Claude Code sends it, with a 5-hour window resetting in an hour. */
function stdin(fiveHourPercent: number): string {
  return JSON.stringify({
    model: { display_name: "Fable 5" },
    rate_limits: {
      five_hour: { used_percentage: fiveHourPercent, resets_at: Math.round((NOW + HOUR_MS) / 1000) },
      seven_day: { used_percentage: 43, resets_at: Math.round((NOW + 6 * 24 * HOUR_MS) / 1000) },
    },
  });
}

/** setUp's cache (5h 15% / 7d 43%) plus the two files the limits policy keeps. */
async function setUpLimits(ageMs: number | null): Promise<{
  usageCachePath: string;
  attemptPath: string;
  statePath: string;
}> {
  const { usageCachePath } = await setUp(ageMs);
  const dir = dirname(usageCachePath);
  return { usageCachePath, attemptPath: join(dir, "limits-attempt.json"), statePath: join(dir, "limits-state.json") };
}

describe("maybeRefreshLimits", () => {
  const base = { limitsCliPath: LIMITS_CLI_PATH, now: NOW, platform: "darwin" as const };

  it("spawns the detached limits bundle when the session is ahead of the cache", async () => {
    const paths = await setUpLimits(3 * 60_000);

    expect(maybeRefreshLimits({ ...base, input: stdin(40), ...paths })).toBe(true);

    expect(spawn).toHaveBeenCalledTimes(1);
    // The limits bundle and nothing else: no `sync`, so no log scan and no upload.
    expect(spawn).toHaveBeenCalledWith(process.execPath, [LIMITS_CLI_PATH], { detached: true, stdio: "ignore" });
    expect(unref).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(paths.attemptPath, "utf-8"))).toEqual({
      at: NOW,
      fiveHour: { percent: 40, resetsAt: NOW + HOUR_MS },
      sevenDay: null, // 43% matches the cache: not what this attempt was for
    });
  });

  it("reads nothing further and spawns nothing when the cache already agrees", async () => {
    const paths = await setUpLimits(3 * 60_000);
    expect(maybeRefreshLimits({ ...base, input: stdin(15), ...paths })).toBe(false);
    // An idle session behind the cache is not evidence of anything.
    expect(maybeRefreshLimits({ ...base, input: stdin(9), ...paths })).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    expect(existsSync(paths.attemptPath)).toBe(false);
  });

  it("stays quiet without rate_limits in the payload", async () => {
    // Older Claude Code, or an API-key login: there is no evidence to act on,
    // so behavior is exactly what it was before this refresh existed.
    const paths = await setUpLimits(3 * 60_000);
    const input = JSON.stringify({ model: { display_name: "Fable 5" } });
    expect(maybeRefreshLimits({ ...base, input, ...paths })).toBe(false);
    expect(maybeRefreshLimits({ ...base, input: "not json", ...paths })).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns once for one number, then again only when it moves", async () => {
    const paths = await setUpLimits(3 * 60_000);
    expect(maybeRefreshLimits({ ...base, input: stdin(40), ...paths })).toBe(true);
    // Every session re-renders every few seconds; the same number is not news.
    expect(maybeRefreshLimits({ ...base, input: stdin(40), ...paths, now: NOW + 5_000 })).toBe(false);
    expect(maybeRefreshLimits({ ...base, input: stdin(40), ...paths, now: NOW + 10 * 60_000 })).toBe(false);
    // Moved, but inside the minute: wait.
    expect(maybeRefreshLimits({ ...base, input: stdin(41), ...paths, now: NOW + 30_000 })).toBe(false);
    expect(maybeRefreshLimits({ ...base, input: stdin(41), ...paths, now: NOW + LIMITS_MIN_AGE_MS + 1 })).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("keeps retrying the same number while attempts fail", async () => {
    const paths = await setUpLimits(3 * 60_000);
    expect(maybeRefreshLimits({ ...base, input: stdin(40), ...paths })).toBe(true);
    await writeFile(paths.statePath, JSON.stringify({ failures: 1, reason: "HTTP 429 rate_limit_error" }));
    expect(maybeRefreshLimits({ ...base, input: stdin(40), ...paths, now: NOW + 90_000 })).toBe(false);
    expect(maybeRefreshLimits({ ...base, input: stdin(40), ...paths, now: NOW + 2 * 60_000 + 1 })).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("does nothing off macOS, where the request could only fail", async () => {
    const paths = await setUpLimits(3 * 60_000);
    expect(maybeRefreshLimits({ ...base, platform: "linux", input: stdin(40), ...paths })).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("swallows a failing spawn, and still records the attempt", async () => {
    spawn.mockImplementation(() => { throw new Error("EAGAIN: cannot fork"); });
    const paths = await setUpLimits(3 * 60_000);

    let result: boolean | undefined;
    expect(() => { result = maybeRefreshLimits({ ...base, input: stdin(40), ...paths }); }).not.toThrow();
    expect(result).toBe(false);
    expect(maybeRefreshLimits({ ...base, input: stdin(40), ...paths, now: NOW + 5_000 })).toBe(false);
    expect(spawn).toHaveBeenCalledTimes(1); // not retried every render
  });
});
