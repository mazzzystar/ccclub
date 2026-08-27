import { describe, expect, it } from "vitest";
import { updateManagedHooks, type ClaudeSettings } from "../hook.js";

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

function pinnedGroup(version: string) {
  return {
    matcher: "",
    hooks: [{
      type: "command",
      command: `npx --yes ccclub@${version} sync --silent`,
      async: true,
      timeout: 30,
    }],
  };
}
