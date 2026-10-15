import { describe, it, expect } from "vitest";
import { formatBostonTime } from "@/lib/clock";

describe("formatBostonTime", () => {
  it("formats a known UTC moment in Boston time (EST)", () => {
    // 2026-01-15 17:30 UTC = 12:30 PM EST (no DST in January)
    const d = new Date("2026-01-15T17:30:00Z");
    expect(formatBostonTime(d)).toBe("12:30 PM");
  });

  it("respects DST in summer (EDT)", () => {
    // 2026-07-15 17:30 UTC = 1:30 PM EDT
    const d = new Date("2026-07-15T17:30:00Z");
    expect(formatBostonTime(d)).toBe("1:30 PM");
  });

  it("uses 12-hour format and 2-digit minutes", () => {
    const d = new Date("2026-07-15T13:05:00Z"); // 9:05 AM EDT
    const out = formatBostonTime(d);
    expect(out).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
    expect(out).toContain(":05");
  });
});
