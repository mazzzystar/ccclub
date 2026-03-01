import { describe, it, expect } from "vitest";
import { formatFetchError } from "../fetch-error.js";

describe("formatFetchError", () => {
  it("returns string for non-Error values", () => {
    expect(formatFetchError("timeout")).toBe("timeout");
    expect(formatFetchError(42)).toBe("42");
  });

  it("unwraps cause chain to show root cause", () => {
    const root = new Error("connection refused");
    const wrapper = new TypeError("fetch failed");
    (wrapper as unknown as { cause: Error }).cause = root;
    expect(formatFetchError(wrapper)).toBe("connection refused");
  });

  it("detects SSL errors and shows troubleshooting hints", () => {
    const sslErr = new Error("SSL routines:tls_get_more_records:packet length too long");
    const wrapper = new TypeError("fetch failed");
    (wrapper as unknown as { cause: Error }).cause = sslErr;
    const msg = formatFetchError(wrapper);
    expect(msg).toContain("packet length too long");
    expect(msg).toContain("TLS/SSL issue");
    expect(msg).toContain("Update Node.js");
  });

  it("detects certificate errors", () => {
    const certErr = new Error("unable to verify the first certificate");
    const wrapper = new TypeError("fetch failed");
    (wrapper as unknown as { cause: Error }).cause = certErr;
    const msg = formatFetchError(wrapper);
    expect(msg).toContain("TLS/SSL issue");
  });

  it("returns plain message when no cause", () => {
    const err = new Error("timeout");
    expect(formatFetchError(err)).toBe("timeout");
  });
});
