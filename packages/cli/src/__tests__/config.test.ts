import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { userInfo } from "node:os";
import { getDefaultDisplayName } from "../config.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return {
    ...original,
    userInfo: vi.fn(),
  };
});

const mockedExecSync = vi.mocked(execSync);
const mockedUserInfo = vi.mocked(userInfo);

describe("getDefaultDisplayName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns git global user.name when available", () => {
    mockedExecSync.mockReturnValueOnce("Alice\n");

    const name = getDefaultDisplayName();

    expect(name).toBe("Alice");
    expect(mockedExecSync).toHaveBeenCalledWith(
      "git config --global user.name",
      expect.objectContaining({ encoding: "utf-8" }),
    );
  });

  it("falls back to macOS id -F when git is not configured", () => {
    mockedExecSync
      .mockImplementationOnce(() => { throw new Error("git not found"); })
      .mockReturnValueOnce("Bob Smith\n");

    const name = getDefaultDisplayName();

    expect(name).toBe("Bob Smith");
    expect(mockedExecSync).toHaveBeenCalledTimes(2);
    expect(mockedExecSync).toHaveBeenNthCalledWith(
      2,
      "id -F",
      expect.objectContaining({ encoding: "utf-8" }),
    );
  });

  it("falls back to OS username when both git and id -F fail", () => {
    mockedExecSync.mockImplementation(() => { throw new Error("command failed"); });
    mockedUserInfo.mockReturnValueOnce({
      username: "charlie",
      uid: 501,
      gid: 20,
      shell: "/bin/zsh",
      homedir: "/Users/charlie",
    });

    const name = getDefaultDisplayName();

    expect(name).toBe("charlie");
  });

  it("returns null when all methods fail", () => {
    mockedExecSync.mockImplementation(() => { throw new Error("command failed"); });
    mockedUserInfo.mockImplementation(() => { throw new Error("no user info"); });

    const name = getDefaultDisplayName();

    expect(name).toBeNull();
  });

  it("skips empty git user.name and falls back", () => {
    mockedExecSync
      .mockReturnValueOnce("   \n")  // empty git name
      .mockReturnValueOnce("Diana\n");  // id -F

    const name = getDefaultDisplayName();

    expect(name).toBe("Diana");
  });

  it("skips empty id -F result and falls back to OS username", () => {
    mockedExecSync
      .mockReturnValueOnce("  \n")  // empty git name
      .mockReturnValueOnce("  \n"); // empty id -F
    mockedUserInfo.mockReturnValueOnce({
      username: "eve",
      uid: 501,
      gid: 20,
      shell: "/bin/zsh",
      homedir: "/Users/eve",
    });

    const name = getDefaultDisplayName();

    expect(name).toBe("eve");
  });
});
