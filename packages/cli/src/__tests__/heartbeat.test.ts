import { describe, it, expect } from "vitest";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { getPlist } from "../heartbeat.js";

const require = createRequire(import.meta.url);
// The CJS postinstall script can't import the ESM heartbeat module, so it
// carries a mirror of the plist template. These tests pin the two together.
const postinstall = require("../../scripts/postinstall.cjs") as {
  buildPlist: (version: string) => string;
};

describe("getPlist", () => {
  const plist = getPlist("0.6.13");

  it("prepends the running Node bin dir to PATH so launchd resolves npx/node under nvm/asdf/volta (#18)", () => {
    const nodeBinDir = dirname(process.execPath);
    const match = plist.match(/<key>PATH<\/key>\s*<string>([^<]+)<\/string>/);
    expect(match, "plist must declare a PATH EnvironmentVariable").not.toBeNull();

    const pathValue = match![1];
    // launchd does not source the user shell profile, so the Node bin dir
    // (e.g. ~/.nvm/versions/node/<ver>/bin) must be in PATH explicitly,
    // otherwise `/usr/bin/env npx` fails with "env: npx: No such file or directory".
    expect(pathValue.startsWith(nodeBinDir)).toBe(true);
    // System fallbacks are still kept for users on Homebrew / system Node.
    expect(pathValue).toContain("/usr/local/bin");
    expect(pathValue).toContain("/usr/bin");
  });

  it("pins the heartbeat to the exact installed ccclub version", () => {
    expect(plist).toContain("/usr/bin/env");
    expect(plist).toContain("npx");
    expect(plist).toContain("--yes");
    expect(plist).toContain("ccclub@0.6.13");
    expect(plist).toContain("sync");
    expect(plist).toContain("--silent");
  });

  it("schedules the heartbeat every 5 minutes", () => {
    expect(plist).toContain("<key>StartInterval</key>");
    expect(plist).toContain("<integer>300</integer>");
  });

  it("escapes XML in interpolated values", () => {
    // Version strings can't contain these, but the log path and PATH come
    // from homedir/execPath, which can — the escaping is shared, so exercise
    // it through the version parameter.
    const escaped = getPlist("0.6.16-a&b<c>");
    expect(escaped).toContain("ccclub@0.6.16-a&amp;b&lt;c&gt;");
    expect(escaped).not.toContain("b<c>");
  });

  it("matches postinstall's mirrored template byte for byte", () => {
    // A drift would only cost one harmless rewrite on the next sync, but the
    // two templates are meant to be the same plist — keep them provably so.
    for (const version of ["0.6.16", "0.7.0-rc.1"]) {
      expect(postinstall.buildPlist(version)).toBe(getPlist(version));
    }
  });
});
