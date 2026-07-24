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
          timeout: 30,
        }],
      },
    ]);
    expect(settings.hooks?.Stop).toEqual([{
      matcher: "",
      hooks: [{
        type: "command",
        command: CURRENT_COMMAND,
        async: true,
        timeout: 30,
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
        timeout: 30,
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
});
