import { describe, it, expect } from "vitest";
import { formatBostonTime, getBostonHourFraction } from "@/lib/clock";

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

describe("getBostonHourFraction", () => {
  it("returns hour 0..24 plus minute fraction in Boston (EST)", () => {
    // 2026-01-15 17:30 UTC = 12:30 PM EST → 12.5
    const d = new Date("2026-01-15T17:30:00Z");
    expect(getBostonHourFraction(d)).toBeCloseTo(12.5, 5);
  });

  it("respects DST in summer (EDT)", () => {
    // 2026-07-15 17:30 UTC = 1:30 PM EDT → 13.5
    const d = new Date("2026-07-15T17:30:00Z");
    expect(getBostonHourFraction(d)).toBeCloseTo(13.5, 5);
  });

  it("returns 0 at midnight Boston", () => {
    // 2026-01-15 05:00 UTC = 12:00 AM EST → 0
    const d = new Date("2026-01-15T05:00:00Z");
    expect(getBostonHourFraction(d)).toBeCloseTo(0, 5);
  });

  it("stays under 24 just before midnight", () => {
    // 11:59 PM EST → 23.983
    const d = new Date("2026-01-16T04:59:00Z");
    const v = getBostonHourFraction(d);
    expect(v).toBeGreaterThanOrEqual(23);
    expect(v).toBeLessThan(24);
  });

  it("encodes minutes as 1/60 increments", () => {
    // 2026-07-15 12:15 UTC = 8:15 AM EDT → 8.25
    const d = new Date("2026-07-15T12:15:00Z");
    expect(getBostonHourFraction(d)).toBeCloseTo(8.25, 5);
  });
});
