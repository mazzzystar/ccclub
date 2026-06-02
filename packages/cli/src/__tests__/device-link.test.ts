import { describe, expect, it } from "vitest";
import { createLinkedConfig } from "../commands/link.js";

describe("device link config", () => {
  it("saves linked terminals as the same user with a deviceId", () => {
    const config = createLinkedConfig({
      apiUrl: "https://ccclub.dev",
      token: "token-b",
      deviceId: "device-b",
      response: {
        userId: "user-a",
        displayName: "Alice",
        groups: ["ABC123"],
        deviceId: "device-b",
      },
    });

    expect(config).toEqual({
      apiUrl: "https://ccclub.dev",
      token: "token-b",
      userId: "user-a",
      displayName: "Alice",
      groups: ["ABC123"],
      deviceId: "device-b",
    });
  });
});
