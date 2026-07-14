import { describe, it, expect } from "vitest";
import { formatLocalDateRange } from "../commands/rank.js";

// Build boundaries from LOCAL midnights so expectations hold in any test-runner
// timezone — mirroring how the server derives windows from the viewer's tz.
function localMidnightIso(y: number, m: number, d: number): string {
  return new Date(y, m - 1, d).toISOString();
}

describe("formatLocalDateRange", () => {
  it("collapses a single local day (Today/Yesterday) to one date", () => {
    const start = localMidnightIso(2026, 3, 5);
    const end = new Date(new Date(start).getTime() + 86_400_000).toISOString();
    expect(formatLocalDateRange(start, end, "daily")).toBe("2026-03-05");
  });

  it("renders multi-day windows with inclusive local end dates", () => {
    const start = localMidnightIso(2026, 3, 5);
    const end = new Date(new Date(start).getTime() + 7 * 86_400_000).toISOString();
    expect(formatLocalDateRange(start, end, "weekly")).toBe("2026-03-05 → 2026-03-11");
  });

  it("omits the meaningless all-time bounds", () => {
    expect(formatLocalDateRange("2020-01-01T00:00:00Z", "2099-12-31T00:00:00Z", "all-time")).toBe("");
  });
});
