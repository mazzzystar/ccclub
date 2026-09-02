import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

// postinstall.cjs resolves ~/.claude/settings.json once, at require time, so
// HOME has to point at a temp dir before the module loads — and the module has
// to load from a clean cache, since sibling test files require it with the
// real HOME. The real user's settings.json is never opened by this file.
const realHome = process.env.HOME;
const home = mkdtempSync(join(tmpdir(), "ccclub-postinstall-"));
const settingsPath = join(home, ".claude", "settings.json");
mkdirSync(join(home, ".claude"), { recursive: true });

const modulePath = require.resolve("../../scripts/postinstall.cjs");
process.env.HOME = home;
delete require.cache[modulePath];
const postinstall = require(modulePath) as {
  updateHooks: () => void;
  buildHookGroup: (version: string) => unknown;
};
// Hand the cache back so anything loading it later gets the real HOME again.
delete require.cache[modulePath];
if (realHome === undefined) delete process.env.HOME;
else process.env.HOME = realHome;

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

const NEWER = "99.0.0";

function group(version: string) {
  return {
    matcher: "",
    hooks: [{
      type: "command",
      command: `npx --yes ccclub@${version} sync --silent`,
      async: true,
      timeout: 120,
    }],
  };
}

function writeSettings(hooks: Record<string, unknown[]>): void {
  writeFileSync(settingsPath, JSON.stringify({ hooks }, null, 2) + "\n");
}

function readSettings(): { hooks: Record<string, unknown[]> } {
  return JSON.parse(readFileSync(settingsPath, "utf-8")) as { hooks: Record<string, unknown[]> };
}

describe("postinstall updateHooks", () => {
  it("leaves an event pinned ahead of the package being installed alone", () => {
    writeSettings({ SessionEnd: [group(NEWER)], Stop: [group(NEWER)] });
    const before = readFileSync(settingsPath, "utf-8");

    postinstall.updateHooks();

    // Byte-identical: an older tarball must not even rewrite the file.
    expect(readFileSync(settingsPath, "utf-8")).toBe(before);
  });

  it("re-pins an older event to the version being installed", () => {
    writeSettings({ SessionEnd: [group("0.0.1")], Stop: [group("0.0.1")] });

    postinstall.updateHooks();

    const { hooks } = readSettings();
    expect(hooks.SessionEnd).toEqual([postinstall.buildHookGroup(pkg.version)]);
    expect(hooks.Stop).toEqual([postinstall.buildHookGroup(pkg.version)]);
  });

  it("upgrades only the stale event when the other is pinned ahead", () => {
    writeSettings({ SessionEnd: [group(NEWER)], Stop: [group("0.0.1")] });

    postinstall.updateHooks();

    const { hooks } = readSettings();
    expect(hooks.SessionEnd).toEqual([group(NEWER)]);
    expect(hooks.Stop).toEqual([postinstall.buildHookGroup(pkg.version)]);
  });

  it("keeps unrelated hooks in an event it refuses to re-pin", () => {
    const unrelated = { matcher: "", hooks: [{ type: "command", command: "notify-send done" }] };
    writeSettings({ SessionEnd: [group(NEWER), unrelated], Stop: [group(NEWER)] });

    postinstall.updateHooks();

    expect(readSettings().hooks.SessionEnd).toEqual([group(NEWER), unrelated]);
  });
});
