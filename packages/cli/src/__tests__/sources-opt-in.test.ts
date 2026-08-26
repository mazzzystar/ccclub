import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_SOURCES,
  DEFAULT_SOURCES,
  OPT_IN_SOURCES,
  UNRANKED_SOURCES,
  isRankedSource,
} from "@ccclub/shared";

// The collector is replaced wholesale so "was Cursor collection entered at
// all?" is observable. A real Cursor collector would read the macOS Keychain
// and call api2.cursor.sh — exactly what must never happen unless enabled.
const { cursorCollect } = vi.hoisted(() => ({ cursorCollect: vi.fn() }));
vi.mock("../sources/cursor.js", () => ({
  cursorCollector: { source: "cursor", label: "Cursor", collect: cursorCollect },
}));

// Every collector and the config file resolve from homedir(); point it at an
// empty temp dir so this test can never read the developer's real logs.
const home = vi.hoisted(() => ({ path: "" }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => home.path };
});

const { loadConfig, saveConfig } = await import("../config.js");
const { collectUsageEntries } = await import("../collector.js");
const { getEffectiveSources, parseSources, resolveCollectSources } = await import("../sources/index.js");
const { enableableSources, withSourceDisabled, withSourceEnabled } = await import("../commands/sources.js");

const BASE_CONFIG = {
  apiUrl: "https://example.invalid",
  token: "t",
  userId: "u",
  displayName: "Tester",
  groups: [],
};

beforeAll(async () => {
  home.path = await mkdtemp(join(tmpdir(), "ccclub-optin-"));
});

afterAll(async () => {
  await rm(home.path, { recursive: true, force: true });
});

beforeEach(() => {
  cursorCollect.mockReset();
  cursorCollect.mockResolvedValue({ source: "cursor", entries: [], turns: [], files: 0, warnings: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("opt-in source registry", () => {
  it("keeps Cursor out of every default collection path", () => {
    expect(OPT_IN_SOURCES).toContain("cursor");
    expect(DEFAULT_SOURCES).not.toContain("cursor");
    expect(DEFAULT_SOURCES).not.toContain("openclaw");
    expect(parseSources(undefined)).toEqual([...DEFAULT_SOURCES]);
  });

  it("still ranks Cursor — opt-in describes collection, not scoring", () => {
    expect(UNRANKED_SOURCES).toEqual(["openclaw"]);
    expect(isRankedSource("cursor")).toBe(true);
    expect(isRankedSource("openclaw")).toBe(false);
  });

  it("offers only opt-in sources that ccclub can actually read", () => {
    expect(enableableSources()).toEqual(["cursor"]);
  });
});

describe("getEffectiveSources", () => {
  it("is the defaults until a config names an opt-in source", () => {
    expect(getEffectiveSources(null)).toEqual([...DEFAULT_SOURCES]);
    expect(getEffectiveSources({})).toEqual([...DEFAULT_SOURCES]);
    expect(getEffectiveSources({ enabledSources: [] })).toEqual([...DEFAULT_SOURCES]);
  });

  it("adds an enabled opt-in source exactly once, case-insensitively", () => {
    expect(getEffectiveSources({ enabledSources: ["cursor"] })).toEqual([...DEFAULT_SOURCES, "cursor"]);
    expect(getEffectiveSources({ enabledSources: [" Cursor ", "cursor"] })).toEqual([...DEFAULT_SOURCES, "cursor"]);
  });

  it("ignores names a hand-edited config could contain", () => {
    // config.json is user-editable: an unknown name, or a source ccclub has
    // no collector for, must not become a collection target.
    expect(getEffectiveSources({ enabledSources: ["openclaw", "nope", ""] })).toEqual([...DEFAULT_SOURCES]);
  });
});

describe("resolveCollectSources", () => {
  it("falls back to the durable source set", () => {
    expect(resolveCollectSources(null)).toEqual([...DEFAULT_SOURCES]);
    expect(resolveCollectSources({ enabledSources: ["cursor"] })).toEqual([...DEFAULT_SOURCES, "cursor"]);
  });

  it("lets CCCLUB_SOURCES filter one run without changing what is tracked", () => {
    vi.stubEnv("CCCLUB_SOURCES", "codex");
    expect(resolveCollectSources({ enabledSources: ["cursor"] })).toEqual(["codex"]);
    expect(getEffectiveSources({ enabledSources: ["cursor"] })).toContain("cursor");
  });

  it("keeps openclaw uncollectable however it is named", () => {
    vi.stubEnv("CCCLUB_SOURCES", "openclaw");
    expect(resolveCollectSources(null)).toEqual([...DEFAULT_SOURCES]);
    vi.stubEnv("CCCLUB_SOURCES", "codex,openclaw");
    expect(resolveCollectSources(null)).toEqual(["codex"]);
  });
});

describe("ccclub sources enable/disable", () => {
  it("enables cursor", () => {
    expect(withSourceEnabled({}, "cursor")).toEqual({
      ok: true,
      source: "cursor",
      enabledSources: ["cursor"],
      changed: true,
    });
    expect(withSourceEnabled({}, "  CURSOR ")).toMatchObject({ ok: true, enabledSources: ["cursor"] });
  });

  it("is idempotent and preserves unrelated entries", () => {
    expect(withSourceEnabled({ enabledSources: ["cursor"] }, "cursor")).toMatchObject({
      ok: true,
      changed: false,
      enabledSources: ["cursor"],
    });
  });

  it("refuses openclaw with the reason, not a silent no-op", () => {
    const change = withSourceEnabled({}, "openclaw");
    expect(change.ok).toBe(false);
    expect(change.ok === false && change.error).toMatch(/not a coding agent/i);
  });

  it("refuses sources that need no enabling, and unknown names", () => {
    expect(withSourceEnabled({}, "claude")).toMatchObject({ ok: false });
    const unknown = withSourceEnabled({}, "windsurf");
    expect(unknown.ok).toBe(false);
    expect(unknown.ok === false && unknown.error).toContain("windsurf");
  });

  it("disables cursor and refuses to disable a default source", () => {
    expect(withSourceDisabled({ enabledSources: ["cursor"] }, "cursor")).toEqual({
      ok: true,
      source: "cursor",
      enabledSources: [],
      changed: true,
    });
    expect(withSourceDisabled({ enabledSources: [] }, "cursor")).toMatchObject({ ok: true, changed: false });
    expect(withSourceDisabled({}, "codex")).toMatchObject({ ok: false });
  });

  it("survives a round trip through ~/.ccclub/config.json", async () => {
    await saveConfig(BASE_CONFIG);
    expect(getEffectiveSources(await loadConfig())).not.toContain("cursor");

    const enabled = withSourceEnabled((await loadConfig())!, "cursor");
    expect(enabled.ok).toBe(true);
    await saveConfig({ ...BASE_CONFIG, enabledSources: enabled.ok ? enabled.enabledSources : [] });

    const afterEnable = await loadConfig();
    expect(afterEnable?.enabledSources).toEqual(["cursor"]);
    expect(getEffectiveSources(afterEnable)).toContain("cursor");

    const disabled = withSourceDisabled(afterEnable!, "cursor");
    await saveConfig({ ...BASE_CONFIG, enabledSources: disabled.ok ? disabled.enabledSources : [] });

    const afterDisable = await loadConfig();
    expect(afterDisable?.enabledSources).toEqual([]);
    expect(getEffectiveSources(afterDisable)).toEqual([...DEFAULT_SOURCES]);
  });
});

describe("collection never reaches an opt-in source by accident", () => {
  it("does not enter the Cursor collector for a user who never enabled it", async () => {
    // Every entry point a default user can hit: an explicit default set, the
    // config-derived set, and the no-options fallback inside the collector.
    await collectUsageEntries({ sources: [...DEFAULT_SOURCES] });
    await collectUsageEntries({ sources: getEffectiveSources(await loadConfig()) });
    await collectUsageEntries({});

    expect(cursorCollect).not.toHaveBeenCalled();
  });

  it("enters it once the config enables it", async () => {
    await collectUsageEntries({ sources: getEffectiveSources({ enabledSources: ["cursor"] }) });

    expect(cursorCollect).toHaveBeenCalledTimes(1);
  });

  it("has no collector at all for openclaw", async () => {
    const result = await collectUsageEntries({ sources: [...AGENT_SOURCES] });
    const openclaw = result.sources.find((source) => source.source === "openclaw");

    expect(openclaw).toEqual({ source: "openclaw", entries: [], turns: [], files: 0, warnings: [] });
  });
});
