import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { newestPinAheadOf, updateManagedHooks, type ClaudeSettings } from "../hook.js";

const require = createRequire(import.meta.url);
// The CJS postinstall script can't import the ESM hook module, so it carries
// its own copy of the hook group. These tests pin the two together - a drifted
// timeout is how a plain reinstall silently reinstated the 30s kill deadline.
const postinstall = require("../../scripts/postinstall.cjs") as {
  buildHookGroup: (version: string) => unknown;
};

const CURRENT_COMMAND = "npx --yes ccclub@0.6.13 sync --silent";

describe("updateManagedHooks", () => {
  it("migrates stale commands without deleting unrelated hooks", () => {
    const settings: ClaudeSettings = {
      hooks: {
        SessionEnd: [
          null,
          {
            matcher: "",
            hooks: [
              { type: "command", command: "ccclub sync --silent", async: true },
              { type: "command", command: "notify-send done" },
            ],
          },
        ],
        Stop: [{
          hooks: [{ type: "command", command: "npx ccclub sync --silent" }],
        }],
      },
    };

    expect(updateManagedHooks(settings, "0.6.13")).toBe(true);
    expect(settings.hooks?.SessionEnd).toEqual([
      null,
      {
        matcher: "",
        hooks: [{ type: "command", command: "notify-send done" }],
      },
      {
        matcher: "",
        hooks: [{
          type: "command",
          command: CURRENT_COMMAND,
          async: true,
          timeout: 120,
        }],
      },
    ]);
    expect(settings.hooks?.Stop).toEqual([{
      matcher: "",
      hooks: [{
        type: "command",
        command: CURRENT_COMMAND,
        async: true,
        timeout: 120,
      }],
    }]);
  });

  it("is idempotent once both events use exactly one current hook", () => {
    const currentGroup = {
      matcher: "",
      hooks: [{
        type: "command",
        command: CURRENT_COMMAND,
        async: true,
        timeout: 120,
      }],
    };
    const settings: ClaudeSettings = {
      hooks: {
        SessionEnd: [structuredClone(currentGroup)],
        Stop: [structuredClone(currentGroup)],
      },
    };
    const before = structuredClone(settings);

    expect(updateManagedHooks(settings, "0.6.13")).toBe(false);
    expect(settings).toEqual(before);
  });

  it("re-pins an older timeout only when the version-pinned command changes", () => {
    // Only the command and matcher are compared, so raising the timeout does
    // not rewrite anybody's settings on its own. Existing installs pick the
    // new value up on the next release, through the normal re-pin path.
    const settings: ClaudeSettings = {
      hooks: {
        SessionEnd: [{ matcher: "", hooks: [{ type: "command", command: CURRENT_COMMAND, async: true, timeout: 30 }] }],
        Stop: [{ matcher: "", hooks: [{ type: "command", command: CURRENT_COMMAND, async: true, timeout: 30 }] }],
      },
    };

    expect(updateManagedHooks(settings, "0.6.13")).toBe(false);
    expect(JSON.stringify(settings)).toContain('"timeout":30');

    expect(updateManagedHooks(settings, "0.6.14")).toBe(true);
    expect(settings.hooks?.Stop).toEqual([{
      matcher: "",
      hooks: [{
        type: "command",
        command: "npx --yes ccclub@0.6.14 sync --silent",
        async: true,
        timeout: 120,
      }],
    }]);
  });

  it("tolerates null and non-object entries inside a group's hooks array", () => {
    // These used to throw on `hook.command`, and the callers' outer catches
    // turned that into a permanently silent no-op of hook install.
    const settings: ClaudeSettings = {
      hooks: {
        SessionEnd: [{
          matcher: "",
          hooks: [null, "junk", { type: "command", command: "ccclub sync --silent" }],
        }],
        Stop: [],
      },
    };

    expect(() => updateManagedHooks(settings, "0.6.13")).not.toThrow();
    const json = JSON.stringify(settings.hooks?.SessionEnd);
    expect(json).toContain(CURRENT_COMMAND); // re-pinned
    expect(json).toContain('"junk"'); // unknown entries preserved
    expect(json).not.toContain('"ccclub sync --silent"'); // legacy removed
  });

  it("does not let 0.8.0 rewrite hooks already pinned to 0.9.3", () => {
    const currentGroup = pinnedGroup("0.9.3");
    const settings: ClaudeSettings = {
      hooks: {
        SessionEnd: [structuredClone(currentGroup)],
        Stop: [structuredClone(currentGroup)],
      },
    };
    const before = structuredClone(settings);

    expect(updateManagedHooks(settings, "0.8.0")).toBe(false);
    expect(settings).toEqual(before);
  });

  it("lets 0.9.3 replace hooks still pinned to 0.8.0", () => {
    const settings: ClaudeSettings = {
      hooks: {
        SessionEnd: [pinnedGroup("0.8.0")],
        Stop: [pinnedGroup("0.8.0")],
      },
    };

    expect(updateManagedHooks(settings, "0.9.3")).toBe(true);
    expect(JSON.stringify(settings.hooks)).toContain("ccclub@0.9.3");
    expect(JSON.stringify(settings.hooks)).not.toContain("ccclub@0.8.0");
  });

  it("upgrades only the stale event when the other event is already newer", () => {
    const settings: ClaudeSettings = {
      hooks: {
        SessionEnd: [pinnedGroup("0.9.3")],
        Stop: [pinnedGroup("0.8.0")],
      },
    };

    expect(updateManagedHooks(settings, "0.9.3")).toBe(true);
    expect(settings.hooks?.SessionEnd).toEqual([pinnedGroup("0.9.3")]);
    expect(JSON.stringify(settings.hooks?.Stop)).toContain("ccclub@0.9.3");
    expect(JSON.stringify(settings.hooks?.Stop)).not.toContain("ccclub@0.8.0");
  });
});

describe("postinstall hook group", () => {
  it("is byte-for-byte what installEventHook writes, timeout included", () => {
    const settings: ClaudeSettings = {};

    expect(updateManagedHooks(settings, "0.9.4")).toBe(true);
    for (const event of ["SessionEnd", "Stop"]) {
      expect(settings.hooks?.[event], event).toEqual([postinstall.buildHookGroup("0.9.4")]);
    }
  });
});

describe("updateManagedHooks force", () => {
  it("re-pins a newer hook only when an explicit path forces it", () => {
    const settings: ClaudeSettings = {
      hooks: {
        SessionEnd: [pinnedGroup("0.9.5")],
        Stop: [pinnedGroup("0.9.5")],
      },
    };

    expect(updateManagedHooks(settings, "0.9.4")).toBe(false);
    expect(JSON.stringify(settings.hooks)).toContain("ccclub@0.9.5");

    expect(updateManagedHooks(settings, "0.9.4", { force: true })).toBe(true);
    expect(JSON.stringify(settings.hooks)).toContain("ccclub@0.9.4");
    expect(JSON.stringify(settings.hooks)).not.toContain("ccclub@0.9.5");
  });

  it("stays a no-op on the current command even under force", () => {
    const settings: ClaudeSettings = {
      hooks: {
        SessionEnd: [pinnedGroup("0.9.4")],
        Stop: [pinnedGroup("0.9.4")],
      },
    };
    const before = structuredClone(settings);

    expect(updateManagedHooks(settings, "0.9.4", { force: true })).toBe(false);
    expect(settings).toEqual(before);
  });
});

describe("newestPinAheadOf", () => {
  it("reports the highest pin ahead of this CLI, and null when none is", () => {
    const ahead: ClaudeSettings = {
      hooks: {
        SessionEnd: [pinnedGroup("0.9.5")],
        Stop: [pinnedGroup("0.10.0")],
      },
    };
    expect(newestPinAheadOf(ahead, "0.9.4")).toBe("0.10.0");

    const behind: ClaudeSettings = {
      hooks: {
        SessionEnd: [pinnedGroup("0.8.0")],
        Stop: [pinnedGroup("0.9.4")],
      },
    };
    expect(newestPinAheadOf(behind, "0.9.4")).toBeNull();
    expect(newestPinAheadOf({}, "0.9.4")).toBeNull();
  });
});

function pinnedGroup(version: string) {
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
