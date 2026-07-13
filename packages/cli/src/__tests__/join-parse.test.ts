import { describe, it, expect } from "vitest";
import { parseInviteCode } from "../commands/join.js";

describe("parseInviteCode", () => {
  it("accepts bare codes in any case", () => {
    expect(parseInviteCode("YHAW6P")).toBe("YHAW6P");
    expect(parseInviteCode("yhaw6p")).toBe("YHAW6P");
    expect(parseInviteCode("  yhaw6p  ")).toBe("YHAW6P");
  });

  it("extracts the code from pasted invite and dashboard URLs", () => {
    expect(parseInviteCode("https://ccclub.dev/invite/YHAW6P")).toBe("YHAW6P");
    expect(parseInviteCode("ccclub.dev/invite/yhaw6p")).toBe("YHAW6P");
    expect(parseInviteCode("https://ccclub.dev/g/YHAW6P")).toBe("YHAW6P");
    expect(parseInviteCode("https://ccclub.dev/invite/YHAW6P?utm_source=x")).toBe("YHAW6P");
  });

  it("rejects input with nothing code-like", () => {
    expect(parseInviteCode("")).toBeNull();
    expect(parseInviteCode("https://ccclub.dev/")).toBeNull();
    expect(parseInviteCode("hello world")).toBeNull();
    expect(parseInviteCode("a".repeat(40))).toBeNull();
  });
});
