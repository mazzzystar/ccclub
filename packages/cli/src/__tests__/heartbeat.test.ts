import { describe, it, expect } from "vitest";
import { dirname } from "node:path";
import { getPlist } from "../heartbeat.js";

describe("getPlist", () => {
  const plist = getPlist();

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

  it("invokes the heartbeat via /usr/bin/env npx ccclub sync --silent", () => {
    expect(plist).toContain("/usr/bin/env");
    expect(plist).toContain("npx");
    expect(plist).toContain("ccclub");
    expect(plist).toContain("sync");
    expect(plist).toContain("--silent");
  });

  it("schedules the heartbeat every 5 minutes", () => {
    expect(plist).toContain("<key>StartInterval</key>");
    expect(plist).toContain("<integer>300</integer>");
  });
});
