import { describe, expect, it } from "vitest";
import { createMergedConfig } from "../commands/merge.js";
import type { CliConfig } from "../config.js";

describe("account merge config", () => {
  it("keeps this terminal token and deviceId while switching display to the target account", () => {
    const existing: CliConfig = {
      apiUrl: "https://ccclub.dev",
      token: "token-b",
      userId: "user-b",
      displayName: "Bob",
      groups: ["BOB123"],
      deviceId: "device-b",
    };

    expect(createMergedConfig(existing, {
      userId: "user-a",
      displayName: "Alice",
      groups: ["ABC123", "BOB123"],
      mergedUserId: "user-b",
    })).toEqual({
      apiUrl: "https://ccclub.dev",
      token: "token-b",
      userId: "user-a",
      displayName: "Alice",
      groups: ["ABC123", "BOB123"],
      deviceId: "device-b",
    });
  });
});
