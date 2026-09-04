import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import { formatCost, renderStatusline, writeRankCache } from "../statusline.js";
import { getStatuslineState, installStatusline, uninstallStatusline, maybeAutoEnableStatusline, STATUSLINE_COMMAND } from "../statusline-install.js";

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
  /** Contents of model-weekly.json; omit to leave the file absent. */
  modelWeekly?: Record<string, unknown>;
  modelWeeklyAgeMs?: number;
}

async function setUpCaches(dir: string, setup: CacheSetup = {}): Promise<{
  usageCachePath: string;
  rankCachePath: string;
  modelWeeklyPath: string;
  now: number;
}> {
  const usageCachePath = join(dir, "usage-cache.json");
  const rankCachePath = join(dir, "rank-cache.json");
  const modelWeeklyPath = join(dir, "model-weekly.json");
  await writeFile(usageCachePath, JSON.stringify({
    snapshot: {
      fiveHour: setup.fiveHour ?? 15,
      sevenDay: setup.sevenDay ?? 43,
      snapshotAt: "x",
    },
    fetchedAt: NOW - (setup.usageAgeMs ?? 60_000),
  }));
  await writeFile(rankCachePath, JSON.stringify({
    rank: 11,
    total: 67,
    costUSD: 19.02,
    fetchedAt: NOW - (setup.rankAgeMs ?? 60_000),
  }));
  if (setup.modelWeekly !== undefined) {
    await writeFile(modelWeeklyPath, JSON.stringify({
      fetchedAt: NOW - (setup.modelWeeklyAgeMs ?? 60_000),
      ...setup.modelWeekly,
    }));
  }
  return { usageCachePath, rankCachePath, modelWeeklyPath, now: NOW };
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
      modelWeeklyPath: join(dir, "missing-model-weekly.json"),
    }));
    expect(line).toBe(" Fable 5");
  });

  it("dims usage limits older than three hours and marks them with a tilde", async () => {
    // The bug this converges away from: a laptop that slept through the
    // heartbeat's 5-minute interval woke with a 3-12h old cache, and the whole
    // limits segment silently disappeared. Stale beats absent.
    const options = await setUpCaches(await makeTempDir(), { usageAgeMs: 4 * 60 * 60 * 1000 });
    const line = renderStatusline(STDIN_JSON, options);
    expect(stripAnsi(line)).toBe(" Fable 5 | 5h: 15% / 7d: 43% ~ | #11/67 $19.0");
    expect(line).toContain("\x1b[38;5;102m15%"); // dim, not the fresh green
    expect(line).not.toContain("\x1b[38;2;99;180;134m15%");
  });

  it("keeps the threshold colors and drops the marker while fresh", async () => {
    const options = await setUpCaches(await makeTempDir(), {
      usageAgeMs: 2 * 60 * 60 * 1000, // still inside the freshness bound
      modelWeekly: { label: "Fable", percent: 8 },
    });
    const line = renderStatusline(STDIN_JSON, options);
    expect(stripAnsi(line)).toBe(" Fable 5 | 5h: 15% / 7d: 43% / Fable: 8% | #11/67 $19.0");
    expect(line).toContain("\x1b[38;2;99;180;134m15%"); // green
  });

  it("omits usage limits older than twelve hours", async () => {
    // Past half a day the 5-hour window has turned over completely, so there
    // is no honest way to render the numbers — dim or otherwise.
    const options = await setUpCaches(await makeTempDir(), {
      usageAgeMs: 13 * 60 * 60 * 1000,
      modelWeekly: { label: "Fable", percent: 8 },
      modelWeeklyAgeMs: 13 * 60 * 60 * 1000,
    });
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

    const line = stripAnsi(renderStatusline(STDIN_JSON, {
      now: morning,
      usageCachePath,
      rankCachePath,
      modelWeeklyPath: join(dir, "model-weekly.json"),
    }));
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
      { now: NOW, usageCachePath: join(dir, "u"), rankCachePath: join(dir, "r"), modelWeeklyPath: join(dir, "m") },
    ));
    expect(line).toBe(" Fable 5 (200K)");
  });

  it("renders the session effort level after the model name", async () => {
    const options = await setUpCaches(await makeTempDir());
    const line = renderStatusline(
      JSON.stringify({ model: { display_name: "Fable 5 (1M context)" }, effort: { level: "xhigh" } }),
      options,
    );
    expect(stripAnsi(line)).toBe(" Fable 5 (1M) xhigh | 5h: 15% / 7d: 43% | #11/67 $19.0");
    expect(line).toContain("\x1b[38;2;212;168;92mxhigh"); // warning color
  });

  it("colors each effort level by intensity and dims unknown levels", async () => {
    const dir = await makeTempDir();
    const render = (level: unknown) => renderStatusline(
      JSON.stringify({ model: { display_name: "Fable 5" }, effort: { level } }),
      { now: NOW, usageCachePath: join(dir, "u"), rankCachePath: join(dir, "r"), modelWeeklyPath: join(dir, "m") },
    );
    expect(render("low")).toContain("\x1b[38;5;102mlow"); // dim
    expect(render("medium")).toContain("\x1b[38;2;122;183;198mmedium"); // cyan
    expect(render("high")).toContain("\x1b[38;2;99;180;134mhigh"); // green
    expect(render("max")).toContain("\x1b[38;2;210;106;106mmax"); // danger
    expect(stripAnsi(render("ULTRA"))).toBe(" Fable 5 ultra");
    expect(render("ULTRA")).toContain("\x1b[38;5;102multra"); // unknown → dim
    expect(stripAnsi(render(42))).toBe(" Fable 5"); // non-string → omitted
  });

  it("renders a model-scoped weekly limit after 5h/7d", async () => {
    const options = await setUpCaches(await makeTempDir(), {
      modelWeekly: { label: "Fable", percent: 8 },
    });
    const line = stripAnsi(renderStatusline(STDIN_JSON, options));
    expect(line).toBe(" Fable 5 | 5h: 15% / 7d: 43% / Fable: 8% | #11/67 $19.0");
  });

  it("colors the model-scoped percentage by threshold", async () => {
    const options = await setUpCaches(await makeTempDir(), {
      modelWeekly: { label: "Fable", percent: 85 },
    });
    expect(renderStatusline(STDIN_JSON, options)).toContain("\x1b[38;2;210;106;106m85%"); // danger ≥ 80
  });

  it("drops a malformed model-scoped entry but keeps the snapshot", async () => {
    for (const modelWeekly of [
      { label: "Fable" }, // no percent
      { percent: 8 }, // no label
      { label: "\x1b\x07", percent: 8 }, // control chars only → empty label
    ]) {
      const options = await setUpCaches(await makeTempDir(), { modelWeekly });
      const line = stripAnsi(renderStatusline(STDIN_JSON, options));
      expect(line).toBe(" Fable 5 | 5h: 15% / 7d: 43% | #11/67 $19.0");
    }
  });

  it("ignores a model-weekly file that is not an object", async () => {
    const options = await setUpCaches(await makeTempDir(), { modelWeekly: { label: "Fable", percent: 8 } });
    await writeFile(options.modelWeeklyPath, "nonsense");
    expect(stripAnsi(renderStatusline(STDIN_JSON, options)))
      .toBe(" Fable 5 | 5h: 15% / 7d: 43% | #11/67 $19.0");
  });

  it("clamps an out-of-range percentage instead of rendering it raw", async () => {
    for (const [percent, shown] of [[-4, 0], [1e21, 100]] as const) {
      const options = await setUpCaches(await makeTempDir(), { modelWeekly: { label: "Fable", percent } });
      expect(stripAnsi(renderStatusline(STDIN_JSON, options)))
        .toBe(` Fable 5 | 5h: 15% / 7d: 43% / Fable: ${shown}% | #11/67 $19.0`);
    }
  });

  it("truncates a long label without leaving a gap before the colon", async () => {
    const options = await setUpCaches(await makeTempDir(), {
      modelWeekly: { label: "Fable Sonnet 4 5    Extra", percent: 21 },
    });
    expect(stripAnsi(renderStatusline(STDIN_JSON, options)))
      .toBe(" Fable 5 | 5h: 15% / 7d: 43% / Fable Sonnet 4 5: 21% | #11/67 $19.0");
  });

  it("keeps the model-scoped segment when an older ccclub rewrites the usage cache", async () => {
    // Builds predating this segment rewrite usage-cache.json wholesale. The
    // segment survives because its data is not in that file.
    const dir = await makeTempDir();
    const options = await setUpCaches(dir, { modelWeekly: { label: "Fable", percent: 21 } });
    await writeFile(options.usageCachePath, JSON.stringify({
      snapshot: { fiveHour: 17, sevenDay: 11, snapshotAt: "x" }, // no modelWeekly
      fetchedAt: NOW - 1_000,
    }));

    const line = stripAnsi(renderStatusline(STDIN_JSON, options));
    expect(line).toBe(" Fable 5 | 5h: 17% / 7d: 11% / Fable: 21% | #11/67 $19.0");
  });

  it("dims and marks a stale model-scoped segment, then drops it past twelve hours", async () => {
    const stale = await setUpCaches(await makeTempDir(), {
      modelWeekly: { label: "Fable", percent: 21 },
      modelWeeklyAgeMs: 4 * 60 * 60 * 1000, // past the 3h freshness bound
    });
    const line = renderStatusline(STDIN_JSON, stale);
    // Only the aged half is dimmed; the fresh 5h/7d numbers keep their color.
    expect(stripAnsi(line)).toBe(" Fable 5 | 5h: 15% / 7d: 43% / Fable: 21% ~ | #11/67 $19.0");
    expect(line).toContain("\x1b[38;5;102m21%");
    expect(line).toContain("\x1b[38;2;99;180;134m15%");

    const ancient = await setUpCaches(await makeTempDir(), {
      modelWeekly: { label: "Fable", percent: 21 },
      modelWeeklyAgeMs: 13 * 60 * 60 * 1000,
    });
    expect(stripAnsi(renderStatusline(STDIN_JSON, ancient)))
      .toBe(" Fable 5 | 5h: 15% / 7d: 43% | #11/67 $19.0");
  });

  it("omits the model-scoped segment when the file is absent", async () => {
    const options = await setUpCaches(await makeTempDir());
    expect(stripAnsi(renderStatusline(STDIN_JSON, options)))
      .toBe(" Fable 5 | 5h: 15% / 7d: 43% | #11/67 $19.0");
  });

  it("strips escape sequences from a cache-supplied label", async () => {
    const options = await setUpCaches(await makeTempDir(), {
      modelWeekly: { label: "\x1b[31mFable", percent: 8 },
    });
    const line = renderStatusline(STDIN_JSON, options);
    expect(line).not.toContain("\x1b[31m"); // the ESC byte itself is gone
    expect(stripAnsi(line)).toContain("[31mFable: 8%"); // printable remainder renders literally
  });
});

async function renderWithRankUrl(dir: string, url: unknown): Promise<string> {
  const rankCachePath = join(dir, "rank-cache.json");
  await writeFile(rankCachePath, JSON.stringify({
    rank: 11, total: 67, costUSD: 19.02, fetchedAt: NOW - 60_000, url,
  }));
  return renderStatusline(STDIN_JSON, {
    now: NOW,
    usageCachePath: join(dir, "no-usage"),
    rankCachePath,
    modelWeeklyPath: join(dir, "no-model-weekly"),
  });
}

describe("rank hyperlink", () => {
  const DASHBOARD = "https://ccclub.dev/g/YHAW6P";

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

describe("stdin sanitization", () => {
  // Both fields land raw in the terminal between our ANSI codes, and the
  // model name can be influenced by an opened repo's .claude/settings.json.
  it("strips control characters from the model display name", async () => {
    const options = await setUpCaches(await makeTempDir());
    const line = renderStatusline(
      JSON.stringify({ model: { display_name: "Fable\x1b]0;pwned\x07 5" } }),
      options,
    );
    expect(line).not.toContain("\x1b]0;");
    expect(line).not.toContain("\x07");
    expect(stripAnsi(line)).toContain("Fable]0;pwned 5");
  });

  it("caps the model display name length", async () => {
    const options = await setUpCaches(await makeTempDir());
    const line = stripAnsi(renderStatusline(
      JSON.stringify({ model: { display_name: "M".repeat(500) } }),
      options,
    ));
    expect(line.length).toBeLessThan(120);
  });

  it("strips control characters from the effort level", async () => {
    const options = await setUpCaches(await makeTempDir());
    const line = renderStatusline(
      JSON.stringify({ model: { display_name: "Fable 5" }, effort: { level: "\x1b[31mMAX" } }),
      options,
    );
    expect(line).not.toContain("\x1b[31m");
    expect(stripAnsi(line)).toContain("[31mmax");
  });
});

describe("cache hardening", () => {
  it("rejects a rank url that could break out of the OSC 8 sequence", async () => {
    for (const url of [
      "https://x\x1b\\\x1b]0;pwned\x07", // ST terminates the sequence early
      "https://x\x07\x1b[31mred", // BEL terminator on most terminals
      "https://" + "a".repeat(300), // unbounded length
      "javascript:alert(1)",
    ]) {
      const line = await renderWithRankUrl(await makeTempDir(), url);
      expect(stripAnsi(line)).toContain("#11/67"); // rank still renders…
      expect(line).not.toContain("\x1b]8;;"); // …but not as a hyperlink
    }
  });

  it("treats future-dated cache timestamps as stale", async () => {
    const options = await setUpCaches(await makeTempDir(), {
      usageAgeMs: -30 * 60_000, // fetchedAt half an hour in the future
      modelWeekly: { label: "Fable", percent: 8 },
      modelWeeklyAgeMs: -30 * 60_000,
    });
    // Rank fetched "later today" survives the same-day rule but not the age rule.
    await writeFile(options.rankCachePath, JSON.stringify({
      rank: 11, total: 67, costUSD: 19.02, fetchedAt: NOW + 30 * 60_000,
    }));
    expect(stripAnsi(renderStatusline(STDIN_JSON, options))).toBe(" Fable 5");
  });
});

describe("maybeAutoEnableStatusline", () => {
  async function makeDeps(dir: string) {
    return {
      settingsPath: join(dir, "settings.json"),
      optOutPath: join(dir, "opt-out"),
      autoEnabledPath: join(dir, "auto-enabled"),
      globalRetryPath: join(dir, "global-retry"),
      checkGlobal: async () => true,
    };
  }

  it("enables once, then never again — even if the user removes the key by hand", async () => {
    const dir = await makeTempDir();
    const deps = await makeDeps(dir);

    expect(await maybeAutoEnableStatusline(deps)).toBe("enabled");
    expect(await getStatuslineState(deps.settingsPath)).toBe("ours");

    // The user edits settings.json and deletes the statusLine key.
    await writeFile(deps.settingsPath, "{}\n");
    expect(await maybeAutoEnableStatusline(deps)).toBe("already-done");
    expect(await getStatuslineState(deps.settingsPath)).toBe("none");
  });

  it("never touches a foreign statusline and honors opt-out", async () => {
    const dir = await makeTempDir();
    const deps = await makeDeps(dir);
    await writeFile(deps.settingsPath, JSON.stringify({ statusLine: { type: "command", command: "my-own" } }));
    expect(await maybeAutoEnableStatusline(deps)).toBe("occupied");

    const dir2 = await makeTempDir();
    const deps2 = await makeDeps(dir2);
    await writeFile(deps2.optOutPath, "x");
    expect(await maybeAutoEnableStatusline(deps2)).toBe("opted-out");
    expect(existsSync(deps2.settingsPath)).toBe(false);
  });

  it("reports a missing global install and succeeds on a later retry", async () => {
    // The bug this converges away from: the enable used to have exactly one
    // shot, at first init/join — if `npm install -g` failed that day, the
    // machine stayed without a statusline forever.
    const deps = await makeDeps(await makeTempDir());
    let installed = false;
    const withGlobal = { ...deps, checkGlobal: async () => installed };

    expect(await maybeAutoEnableStatusline(withGlobal)).toBe("no-global");
    expect(await getStatuslineState(deps.settingsPath)).toBe("none");

    installed = true; // the user runs npm install -g at some later point
    expect(await maybeAutoEnableStatusline(withGlobal)).toBe("enabled");
    expect(await getStatuslineState(deps.settingsPath)).toBe("ours");
  });

  it("throttles only the global probe, and only for background callers", async () => {
    const NOW = new Date("2026-08-07T10:00:00Z").getTime();
    const DAY = 24 * 60 * 60 * 1000;
    const deps = await makeDeps(await makeTempDir());
    let probes = 0;
    const failing = { ...deps, checkGlobal: async () => { probes++; return false; } };

    // Background caller: first probe runs, second is throttled away.
    expect(await maybeAutoEnableStatusline({ ...failing, retryThrottleMs: DAY, now: NOW })).toBe("no-global");
    expect(await maybeAutoEnableStatusline({ ...failing, retryThrottleMs: DAY, now: NOW + 60_000 })).toBe("throttled");
    expect(probes).toBe(1);

    // An interactive caller (no throttle) probes regardless.
    expect(await maybeAutoEnableStatusline({ ...failing, now: NOW + 120_000 })).toBe("no-global");
    expect(probes).toBe(2);

    // Past the window the background caller probes again — and a success
    // enables even though earlier attempts failed.
    const succeeding = { ...deps, retryThrottleMs: DAY, now: NOW + DAY + 60_000 };
    expect(await maybeAutoEnableStatusline(succeeding)).toBe("enabled");
  });

  it("classifies a pipeline that merely mentions ccclub as foreign", async () => {
    const dir = await makeTempDir();
    const settingsPath = join(dir, "settings.json");
    await writeFile(settingsPath, JSON.stringify({
      statusLine: { type: "command", command: "ccclub-statusline | my-filter" },
    }));
    expect(await getStatuslineState(settingsPath)).toBe("other");
    // "other" is the protected class: off refuses to delete it.
    await uninstallStatusline(settingsPath);
    expect((await readFile(settingsPath, "utf-8"))).toContain("my-filter");
  });
});
