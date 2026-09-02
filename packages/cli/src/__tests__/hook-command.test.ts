import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

const mocks = vi.hoisted(() => ({
  installHook: vi.fn(async () => true),
  isHookInstalled: vi.fn(() => false),
  newerPinnedHookVersion: vi.fn((_version?: string): string | null => null),
  installHeartbeat: vi.fn(async () => true),
  newerPinnedHeartbeatVersion: vi.fn((_version?: string): string | null => null),
}));

// Both entrypoint modules are mocked, so this file never reads or writes the
// real ~/.claude/settings.json or ~/Library/LaunchAgents, and launchctl is
// never spawned. What is under test is the command's decision, not the writes.
vi.mock("../hook.js", () => ({
  installHook: mocks.installHook,
  isHookInstalled: mocks.isHookInstalled,
  newerPinnedHookVersion: mocks.newerPinnedHookVersion,
}));
vi.mock("../heartbeat.js", () => ({
  installHeartbeat: mocks.installHeartbeat,
  newerPinnedHeartbeatVersion: mocks.newerPinnedHeartbeatVersion,
}));
vi.mock("../version.js", () => ({ getCurrentVersion: () => "0.9.4" }));

const { hookCommand } = await import("../commands/hook.js");

const realPlatform = process.platform;

function setPlatform(value: string): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

let log: MockInstance<typeof console.log>;

function output(): string {
  return log.mock.calls.map((args) => args.join(" ")).join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.installHook.mockResolvedValue(true);
  mocks.isHookInstalled.mockReturnValue(false);
  mocks.newerPinnedHookVersion.mockReturnValue(null);
  mocks.installHeartbeat.mockResolvedValue(true);
  mocks.newerPinnedHeartbeatVersion.mockReturnValue(null);
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  log.mockRestore();
  setPlatform(realPlatform);
});

describe("hookCommand", () => {
  it("forces both entrypoints past a pin ahead of this CLI", async () => {
    setPlatform("darwin");
    mocks.newerPinnedHeartbeatVersion.mockReturnValue("0.9.5");
    mocks.newerPinnedHookVersion.mockReturnValue("0.9.5");

    await hookCommand();

    expect(mocks.installHook).toHaveBeenCalledWith({ force: true });
    expect(mocks.installHeartbeat).toHaveBeenCalledWith({ force: true });
    expect(output()).toContain("Auto-sync re-pinned from ccclub@0.9.5 to this 0.9.4.");
  });

  it("still re-pins when only the LaunchAgent is ahead and the hook is current", async () => {
    // The case the sync notice points here for: isHookInstalled says yes, so
    // the old early return would have printed "already set up" and left the
    // newer plist in place.
    setPlatform("darwin");
    mocks.isHookInstalled.mockReturnValue(true);
    mocks.newerPinnedHeartbeatVersion.mockReturnValue("0.9.5");

    await hookCommand();

    expect(mocks.installHeartbeat).toHaveBeenCalledWith({ force: true });
    expect(output()).not.toContain("already set up");
  });

  it("skips the LaunchAgent off macOS", async () => {
    setPlatform("linux");
    mocks.newerPinnedHookVersion.mockReturnValue("0.9.5");

    await hookCommand();

    expect(mocks.installHook).toHaveBeenCalledWith({ force: true });
    expect(mocks.installHeartbeat).not.toHaveBeenCalled();
  });

  it("touches nothing when neither entrypoint is ahead and the hook is current", async () => {
    setPlatform("darwin");
    mocks.isHookInstalled.mockReturnValue(true);

    await hookCommand();

    expect(mocks.installHook).not.toHaveBeenCalled();
    expect(mocks.installHeartbeat).not.toHaveBeenCalled();
    expect(output()).toContain("already set up");
  });
});
