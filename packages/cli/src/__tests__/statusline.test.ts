import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import { formatCost, renderStatusline, writeRankCache } from "../statusline.js";
import { getStatuslineState, installStatusline, uninstallStatusline, STATUSLINE_COMMAND } from "../statusline-install.js";

const NOW = new Date("2026-07-13T12:00:00").getTime(); // local noon: same-day checks stay same-day

const STDIN_JSON = JSON.stringify({
  model: { display_name: "Fable 5" },
  context_window: { used_percentage: 23 },
  cost: { total_cost_usd: 34.6 },
});

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ccclub-sl-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function stripAnsi(text: string): string {
  // SGR colors and OSC 8 hyperlink wrappers.
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
}

interface CacheSetup {
  usageAgeMs?: number;
  rankAgeMs?: number;
  fiveHour?: number;
  sevenDay?: number;
}

async function setUpCaches(dir: string, setup: CacheSetup = {}): Promise<{ usageCachePath: string; rankCachePath: string; now: number }> {
  const usageCachePath = join(dir, "usage-cache.json");
  const rankCachePath = join(dir, "rank-cache.json");
  await writeFile(usageCachePath, JSON.stringify({
    snapshot: { fiveHour: setup.fiveHour ?? 15, sevenDay: setup.sevenDay ?? 43, snapshotAt: "x" },
    fetchedAt: NOW - (setup.usageAgeMs ?? 60_000),
  }));
  await writeFile(rankCachePath, JSON.stringify({
    rank: 11,
    total: 67,
    costUSD: 19.02,
    fetchedAt: NOW - (setup.rankAgeMs ?? 60_000),
  }));
  return { usageCachePath, rankCachePath, now: NOW };
}

describe("renderStatusline", () => {
  it("renders model, usage limits, and rank", async () => {
    const options = await setUpCaches(await makeTempDir());
    const line = stripAnsi(renderStatusline(STDIN_JSON, options));
    expect(line).toBe(" Fable 5 | 5h: 15% / 7d: 43% | #11/67 $19.0");
  });

  it("omits segments whose caches are missing", async () => {
    const dir = await makeTempDir();
    const line = stripAnsi(renderStatusline(STDIN_JSON, {
      now: NOW,
      usageCachePath: join(dir, "missing-usage.json"),
      rankCachePath: join(dir, "missing-rank.json"),
    }));
    expect(line).toBe(" Fable 5");
  });

  it("omits usage limits older than three hours", async () => {
    const options = await setUpCaches(await makeTempDir(), { usageAgeMs: 4 * 60 * 60 * 1000 });
    const line = stripAnsi(renderStatusline(STDIN_JSON, options));
    expect(line).toBe(" Fable 5 | #11/67 $19.0");
  });

  it("omits rank fetched on a different local day", async () => {
    // 8am local, rank fetched 11h earlier (9pm yesterday): under the age cap
    // but yesterday's "today cost" must not render.
    const dir = await makeTempDir();
    const morning = new Date("2026-07-13T08:00:00").getTime();
    const usageCachePath = join(dir, "usage-cache.json");
    const rankCachePath = join(dir, "rank-cache.json");
    await writeFile(usageCachePath, JSON.stringify({
      snapshot: { fiveHour: 15, sevenDay: 43, snapshotAt: "x" },
      fetchedAt: morning - 60_000,
    }));
    await writeFile(rankCachePath, JSON.stringify({
      rank: 11, total: 67, costUSD: 19.02,
      fetchedAt: morning - 11 * 60 * 60 * 1000,
    }));

    const line = stripAnsi(renderStatusline(STDIN_JSON, { now: morning, usageCachePath, rankCachePath }));
    expect(line).toBe(" Fable 5 | 5h: 15% / 7d: 43%");
  });

  it("colors usage percentages by threshold", async () => {
    const options = await setUpCaches(await makeTempDir(), { fiveHour: 85, sevenDay: 65 });
    const line = renderStatusline(STDIN_JSON, options);
    expect(line).toContain("\x1b[38;2;210;106;106m85%"); // danger ≥ 80
    expect(line).toContain("\x1b[38;2;212;168;92m65%"); // warning ≥ 60
  });

  it("returns empty output for malformed or empty stdin", async () => {
    const options = await setUpCaches(await makeTempDir());
    expect(renderStatusline("not json", options)).toBe("");
    expect(renderStatusline("", options)).toBe("");
    expect(renderStatusline("[1,2]", { ...options })).not.toContain("undefined");
  });

  it("shortens the context suffix in model names", async () => {
    const dir = await makeTempDir();
    const line = stripAnsi(renderStatusline(
      JSON.stringify({ model: { display_name: "Fable 5 (200K context)" } }),
      { now: NOW, usageCachePath: join(dir, "u"), rankCachePath: join(dir, "r") },
    ));
    expect(line).toBe(" Fable 5 (200K)");
  });
});

describe("rank hyperlink", () => {
  const DASHBOARD = "https://ccclub.dev/g/YHAW6P";

  async function renderWithRankUrl(dir: string, url: unknown): Promise<string> {
    const rankCachePath = join(dir, "rank-cache.json");
    await writeFile(rankCachePath, JSON.stringify({
      rank: 11, total: 67, costUSD: 19.02, fetchedAt: NOW - 60_000, url,
    }));
    return renderStatusline(STDIN_JSON, {
      now: NOW,
      usageCachePath: join(dir, "no-usage"),
      rankCachePath,
    });
  }

  it("wraps the rank segment in an OSC 8 hyperlink to the group dashboard", async () => {
    const line = await renderWithRankUrl(await makeTempDir(), DASHBOARD);
    expect(line).toContain(`\x1b]8;;${DASHBOARD}\x1b\\`); // open
    expect(line).toContain("\x1b]8;;\x1b\\"); // close
    // The visible text is unchanged.
    expect(stripAnsi(line)).toBe(" Fable 5 | #11/67 $19.0");
  });

  it("renders plain text when the cache has no url (e.g. written by an older version)", async () => {
    const line = await renderWithRankUrl(await makeTempDir(), undefined);
    expect(line).not.toContain("\x1b]8");
    expect(stripAnsi(line)).toBe(" Fable 5 | #11/67 $19.0");
  });

  it("ignores non-http urls", async () => {
    const line = await renderWithRankUrl(await makeTempDir(), "javascript:alert(1)");
    expect(line).not.toContain("\x1b]8");
  });
});

describe("formatCost", () => {
  it("scales precision with magnitude", () => {
    expect(formatCost(3.456)).toBe("$3.46");
    expect(formatCost(19.02)).toBe("$19.0");
    expect(formatCost(866.4)).toBe("$866");
    expect(formatCost(1012)).toBe("$1,012");
  });
});

describe("writeRankCache", () => {
  it("stamps fetchedAt so a fresh write renders immediately", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "rank-cache.json");
    await writeRankCache({ rank: 2, total: 5, costUSD: 7.5 }, path);
    const stored = JSON.parse(await readFile(path, "utf-8"));
    expect(stored).toMatchObject({ rank: 2, total: 5, costUSD: 7.5 });
    expect(Math.abs(stored.fetchedAt - Date.now())).toBeLessThan(5_000);
  });
});

describe("statusline install", () => {
  it("installs into settings without statusline and preserves other keys", async () => {
    const dir = await makeTempDir();
    const settingsPath = join(dir, "settings.json");
    await writeFile(settingsPath, JSON.stringify({ hooks: { Stop: [] }, model: "opus" }));

    expect(await getStatuslineState(settingsPath)).toBe("none");
    expect(await installStatusline(settingsPath)).toBe(true);

    const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
    expect(settings.statusLine).toEqual({ type: "command", command: STATUSLINE_COMMAND });
    expect(settings.model).toBe("opus");
    expect(await getStatuslineState(settingsPath)).toBe("ours");
  });

  it("creates settings.json when absent", async () => {
    const settingsPath = join(await makeTempDir(), "settings.json");
    expect(await installStatusline(settingsPath)).toBe(true);
    const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
    expect(settings.statusLine.command).toBe(STATUSLINE_COMMAND);
  });

  it("never overwrites a foreign statusline (e.g. cc-costline)", async () => {
    const dir = await makeTempDir();
    const settingsPath = join(dir, "settings.json");
    const original = { statusLine: { type: "command", command: "cc-costline render" } };
    await writeFile(settingsPath, JSON.stringify(original));

    expect(await getStatuslineState(settingsPath)).toBe("other");
    expect(await installStatusline(settingsPath)).toBe(false);
    expect(JSON.parse(await readFile(settingsPath, "utf-8"))).toEqual(original);

    // Uninstall must not remove someone else's statusline either.
    expect(await uninstallStatusline(settingsPath)).toBe(true);
    expect(JSON.parse(await readFile(settingsPath, "utf-8"))).toEqual(original);
  });

  it("uninstalls only our own statusline", async () => {
    const dir = await makeTempDir();
    const settingsPath = join(dir, "settings.json");
    await writeFile(settingsPath, JSON.stringify({
      statusLine: { type: "command", command: STATUSLINE_COMMAND },
      hooks: { Stop: [] },
    }));

    expect(await uninstallStatusline(settingsPath)).toBe(true);
    const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
    expect(settings.statusLine).toBeUndefined();
    expect(settings.hooks).toEqual({ Stop: [] });
  });

  it("refuses to touch unparseable settings", async () => {
    const dir = await makeTempDir();
    const settingsPath = join(dir, "settings.json");
    await writeFile(settingsPath, "{broken json");

    expect(await getStatuslineState(settingsPath)).toBe("other");
    expect(await installStatusline(settingsPath)).toBe(false);
    expect(await uninstallStatusline(settingsPath)).toBe(false);
    expect(await readFile(settingsPath, "utf-8")).toBe("{broken json");
  });
});
