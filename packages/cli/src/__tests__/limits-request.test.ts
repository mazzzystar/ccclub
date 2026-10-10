import { readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// refreshUsageLimits end to end, minus the two things a test must not touch:
// the developer's keychain and Anthropic's API. `security` is replaced through
// child_process, the request through global fetch, and homedir points at a
// temp dir — set while hoisting, because usage-limits.ts resolves its cache
// path at import time.

const { execFileSync, home } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  return { execFileSync: vi.fn(), home: fs.mkdtempSync(path.join(os.tmpdir(), "ccclub-lr-")) };
});
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync };
});
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => home };
});

const { refreshUsageLimits } = await import("../usage-limits.js");

const CONFIG_DIR = join(home, ".ccclub");
const USAGE_CACHE = join(CONFIG_DIR, "usage-cache.json");
const MODEL_WEEKLY = join(CONFIG_DIR, "model-weekly.json");

const fetchMock = vi.fn();

function keychainHolds(oauth: Record<string, unknown> | string): void {
  execFileSync.mockReturnValue(typeof oauth === "string" ? oauth : JSON.stringify({ claudeAiOauth: oauth }));
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}): void {
  fetchMock.mockResolvedValue(new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers }));
}

const VALID_TOKEN = { accessToken: "sk-test-token", expiresAt: Date.now() + 60 * 60 * 1000 };
const USAGE_BODY = {
  five_hour: { utilization: 97.0 },
  seven_day: { utilization: 60.0 },
  limits: [{ kind: "weekly_scoped", percent: 1, scope: { model: { display_name: "Fable" } } }],
};

function seedCaches(ageMs: number, fiveHour = 82): void {
  const fetchedAt = Date.now() - ageMs;
  writeFileSync(USAGE_CACHE, JSON.stringify({ snapshot: { fiveHour, sevenDay: 56, snapshotAt: "x" }, fetchedAt }));
  writeFileSync(MODEL_WEEKLY, JSON.stringify({ label: "Fable", percent: 1, fetchedAt }));
}

beforeEach(() => {
  rmSync(CONFIG_DIR, { recursive: true, force: true });
  mkdirSync(CONFIG_DIR, { recursive: true });
  execFileSync.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  keychainHolds(VALID_TOKEN);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("refreshUsageLimits", () => {
  it("fetches, and writes both caches the statusline reads", async () => {
    respond(200, USAGE_BODY);
    const result = await refreshUsageLimits();
    expect(result.state).toBe("fetched");
    expect(result.snapshot).toMatchObject({ fiveHour: 97, sevenDay: 60 });
    expect(JSON.parse(readFileSync(USAGE_CACHE, "utf-8")).snapshot).toMatchObject({ fiveHour: 97, sevenDay: 60 });
    expect(JSON.parse(readFileSync(MODEL_WEEKLY, "utf-8"))).toMatchObject({ label: "Fable", percent: 1 });
  });

  it("sends the token as a header and never to the keychain command line", async () => {
    respond(200, USAGE_BODY);
    await refreshUsageLimits();
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://api.anthropic.com/api/oauth/usage");
    expect(init.headers.Authorization).toBe("Bearer sk-test-token");
    expect(JSON.stringify(execFileSync.mock.calls)).not.toContain("sk-test-token");
  });

  it("skips the request while the cache is younger than maxAgeMs", async () => {
    seedCaches(2 * 60_000);
    const result = await refreshUsageLimits(); // sync's default: five minutes
    expect(result).toMatchObject({ state: "cached", snapshot: { fiveHour: 82 } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled(); // not even the keychain
  });

  it("asks again past a shorter maxAgeMs — the statusline's one-minute refresh", async () => {
    seedCaches(2 * 60_000);
    respond(200, USAGE_BODY);
    const result = await refreshUsageLimits({ maxAgeMs: 60_000 });
    expect(result).toMatchObject({ state: "fetched", snapshot: { fiveHour: 97 } });
  });

  it("reports a timeout as one, and hands back the stale cache with it", async () => {
    seedCaches(30 * 60_000);
    fetchMock.mockRejectedValue(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    const result = await refreshUsageLimits({ timeoutMs: 15_000 });
    expect(result).toMatchObject({
      state: "failed",
      snapshot: { fiveHour: 82 }, // still the best there is
      failure: { reason: "request timed out after 15s" },
    });
    // The stale cache keeps its honest timestamp: a failure must not relaunder it as fresh.
    expect(Date.now() - JSON.parse(readFileSync(USAGE_CACHE, "utf-8")).fetchedAt).toBeGreaterThan(29 * 60_000);
  });

  it("reports rate limiting with the server's Retry-After", async () => {
    respond(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, { "retry-after": "120" });
    const result = await refreshUsageLimits();
    expect(result).toMatchObject({
      state: "failed",
      failure: { reason: "HTTP 429 rate_limit_error", retryAfterMs: 120_000 },
    });
    // An error body is never read as a snapshot of zeros.
    expect(result.snapshot?.fiveHour).not.toBe(0);
  });

  it("reports an unreadable error body by its status", async () => {
    respond(502, "<html>Bad Gateway</html>");
    const result = await refreshUsageLimits();
    expect(result).toMatchObject({ state: "failed", failure: { reason: "HTTP 502" } });
  });

  it("unwraps a network error to its cause", async () => {
    fetchMock.mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }));
    const result = await refreshUsageLimits();
    expect(result).toMatchObject({ state: "failed", failure: { reason: "request failed: ENOTFOUND" } });
  });

  it("does not send an expired token", async () => {
    keychainHolds({ accessToken: "sk-test-token", expiresAt: Date.now() - 60_000 });
    const result = await refreshUsageLimits();
    expect(result).toMatchObject({ state: "failed" });
    expect(result.state === "failed" && result.failure.reason).toContain("OAuth token expired");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a slow keychain as loud, and a missing one as quiet", async () => {
    execFileSync.mockImplementation(() => { throw Object.assign(new Error("spawnSync security ETIMEDOUT"), { code: "ETIMEDOUT" }); });
    expect(await refreshUsageLimits()).toMatchObject({
      state: "failed",
      failure: { reason: "keychain lookup timed out after 5s" },
    });

    // Linux and Windows: there is no `security` binary at all.
    execFileSync.mockImplementation(() => { throw Object.assign(new Error("spawnSync security ENOENT"), { code: "ENOENT" }); });
    expect(await refreshUsageLimits()).toMatchObject({ state: "failed", failure: { quiet: true } });

    // macOS without a Claude login: `security` exits 44, item not found.
    execFileSync.mockImplementation(() => { throw Object.assign(new Error("Command failed"), { status: 44 }); });
    expect(await refreshUsageLimits()).toMatchObject({ state: "failed", failure: { quiet: true } });

    keychainHolds({ refreshToken: "only" });
    expect(await refreshUsageLimits()).toMatchObject({ state: "failed", failure: { quiet: true } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never puts the token in a failure reason", async () => {
    fetchMock.mockRejectedValue(Object.assign(new TypeError("fetch failed"), {
      cause: { message: "connect ECONNREFUSED 160.79.104.10:443" },
    }));
    const result = await refreshUsageLimits();
    expect(JSON.stringify(result)).not.toContain("sk-test-token");
  });
});
