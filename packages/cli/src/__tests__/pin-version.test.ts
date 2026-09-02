import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { compareNpmVersions, extractPinnedVersion, isNewerPin, pinNotice } from "../pin-version.js";

const require = createRequire(import.meta.url);
const postinstall = require("../../scripts/postinstall.cjs") as {
  compareNpmVersions: (a: string, b: string) => number | null;
  extractPinnedVersion: (text: string) => string | null;
  isNewerPin: (installed: string | null, current: string) => boolean;
};

const CASES: Array<[string, string, number]> = [
  ["0.8.0", "0.9.3", -1],
  ["0.9.3", "0.8.0", 1],
  ["0.9.3", "0.9.3", 0],
  ["0.10.0", "0.9.3", 1],
  ["0.9.4-rc.1", "0.9.3", 1],
  ["0.9.4-rc.1", "0.9.4", -1],
  ["0.9.4", "0.9.4-rc.1", 1],
  ["0.9.4-rc.1", "0.9.4-rc.2", -1],
  ["0.0.0-dev", "0.9.3", -1],
  ["1.0.0+build.1", "1.0.0", 0],
];

describe("compareNpmVersions", () => {
  it("orders releases the way npm would, including prereleases", () => {
    for (const [left, right, sign] of CASES) {
      const cmp = compareNpmVersions(left, right);
      expect(cmp, `${left} vs ${right}`).not.toBeNull();
      expect(Math.sign(cmp!), `${left} vs ${right}`).toBe(sign);
      expect(Math.sign(postinstall.compareNpmVersions(left, right)!), `postinstall ${left} vs ${right}`).toBe(sign);
    }
  });

  it("refuses to rank tags that are not versions", () => {
    expect(compareNpmVersions("latest", "0.9.3")).toBeNull();
    expect(compareNpmVersions("0.9.3", "latest")).toBeNull();
    expect(postinstall.compareNpmVersions("latest", "0.9.3")).toBeNull();
  });
});

describe("isNewerPin", () => {
  it("treats a forward pin as newer and everything else as rewriteable", () => {
    expect(isNewerPin("0.9.3", "0.8.0")).toBe(true);
    expect(isNewerPin("0.8.0", "0.9.3")).toBe(false);
    expect(isNewerPin("0.9.3", "0.9.3")).toBe(false);
    expect(isNewerPin(null, "0.9.3")).toBe(false);
    expect(isNewerPin("latest", "0.9.3")).toBe(false);
    expect(postinstall.isNewerPin("0.9.3", "0.8.0")).toBe(true);
    expect(postinstall.isNewerPin("latest", "0.9.3")).toBe(false);
  });
});

describe("extractPinnedVersion", () => {
  it("reads the pin out of a heartbeat argv or a hook command", () => {
    expect(extractPinnedVersion("npx --yes ccclub@0.9.3 sync --silent")).toBe("0.9.3");
    expect(extractPinnedVersion("<string>ccclub@0.8.0</string>")).toBe("0.8.0");
    expect(extractPinnedVersion("ccclub sync --silent")).toBeNull();
    expect(postinstall.extractPinnedVersion("<string>ccclub@0.8.0</string>")).toBe("0.8.0");
  });

  it("ignores a ccclub@ that is not one of the two pinned entrypoints", () => {
    const decoy = "<string>/Users/me/ccclub@99.0.0/sync.log</string>";
    expect(extractPinnedVersion(decoy)).toBeNull();
    expect(postinstall.extractPinnedVersion(decoy)).toBeNull();

    // A decoy sharing the file must not outrank the real pin, or the guard
    // would keep a version nobody installed.
    const plist = `${decoy}\n<string>ccclub@0.9.3</string>`;
    expect(extractPinnedVersion(plist)).toBe("0.9.3");
    expect(postinstall.extractPinnedVersion(plist)).toBe("0.9.3");

    const command = "npx --yes ccclub@0.9.3 sync --silent # was ccclub@99.0.0";
    expect(extractPinnedVersion(command)).toBe("0.9.3");
    expect(postinstall.extractPinnedVersion(command)).toBe("0.9.3");
  });
});

describe("pinNotice", () => {
  it("says nothing unless the on-disk pin is ahead of this CLI", () => {
    expect(pinNotice(null, "0.9.4")).toBeNull();
    expect(pinNotice(null, "0.9.4", true)).toBeNull();
  });

  it("names both versions and how to take the pin back", () => {
    expect(pinNotice("0.9.5", "0.9.4")).toBe(
      'Background sync stays on ccclub@0.9.5 (newer than this 0.9.4). Run "ccclub hook" to pin this version instead.',
    );
  });

  it("reports what an explicit path moved instead of what it kept", () => {
    // Names neither entrypoint: `ccclub hook` re-pins the hooks and the
    // LaunchAgent in one go.
    expect(pinNotice("0.9.5", "0.9.4", true)).toBe(
      "Auto-sync re-pinned from ccclub@0.9.5 to this 0.9.4.",
    );
  });
});
