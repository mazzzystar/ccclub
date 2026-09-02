import { describe, it, expect } from "vitest";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { getPlist, shouldKeepExistingPlist } from "../heartbeat.js";

const require = createRequire(import.meta.url);
// The CJS postinstall script can't import the ESM heartbeat module, so it
// carries a mirror of the plist template. These tests pin the two together.
const postinstall = require("../../scripts/postinstall.cjs") as {
  buildPlist: (version: string) => string;
  shouldKeepExistingPlist: (existing: string, version: string) => boolean;
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

describe("shouldKeepExistingPlist", () => {
  it("lets 0.9.3 keep the pin when 0.8.0 runs, and lets 0.9.3 replace 0.8.0", () => {
    const v803 = getPlist("0.8.0");
    const v093 = getPlist("0.9.3");

    expect(shouldKeepExistingPlist(v093, "0.8.0")).toBe(true);
    expect(shouldKeepExistingPlist(v803, "0.9.3")).toBe(false);
    expect(shouldKeepExistingPlist(v093, "0.9.3")).toBe(true);
    expect(postinstall.shouldKeepExistingPlist(v093, "0.8.0")).toBe(true);
    expect(postinstall.shouldKeepExistingPlist(v803, "0.9.3")).toBe(false);
  });

  it("still rewrites same-version PATH drift, but not a newer pin with a different PATH", () => {
    const drifted = getPlist("0.9.3").replace(":/usr/bin:/bin", ":/opt/custom/bin:/bin");
    expect(drifted).not.toBe(getPlist("0.9.3"));
    expect(shouldKeepExistingPlist(drifted, "0.9.3")).toBe(false);
    expect(shouldKeepExistingPlist(drifted, "0.8.0")).toBe(true);
    expect(postinstall.shouldKeepExistingPlist(drifted, "0.9.3")).toBe(false);
    expect(postinstall.shouldKeepExistingPlist(drifted, "0.8.0")).toBe(true);
  });

  it("repairs an unreadable pin instead of treating it as newer", () => {
    expect(shouldKeepExistingPlist("not a plist", "0.9.3")).toBe(false);
    expect(postinstall.shouldKeepExistingPlist("not a plist", "0.9.3")).toBe(false);
  });
});

describe("shouldKeepExistingPlist force", () => {
  it("re-pins a newer plist only when an explicit path forces it", () => {
    const v095 = getPlist("0.9.5");

    expect(shouldKeepExistingPlist(v095, "0.9.4")).toBe(true);
    expect(shouldKeepExistingPlist(v095, "0.9.4", { force: true })).toBe(false);
  });

  it("stays a no-op on an identical template even under force", () => {
    // Rewriting a byte-identical plist would churn a launchctl unload/load
    // for nothing, so force must not reach past the equality check.
    const same = getPlist("0.9.4");
    expect(shouldKeepExistingPlist(same, "0.9.4", { force: true })).toBe(true);
  });

  it("leaves a newer pin with a drifted template to the explicit paths", () => {
    // Deliberate trade-off: an older CLI cannot repair a broken newer pin on
    // its own (that is the downgrade loop); only force takes it back.
    const drifted = getPlist("0.9.5").replace(":/usr/bin:/bin", ":/opt/gone/bin:/bin");

    expect(shouldKeepExistingPlist(drifted, "0.9.4")).toBe(true);
    expect(shouldKeepExistingPlist(drifted, "0.9.4", { force: true })).toBe(false);
  });
});
