// Pure time formatter for the Hero's Boston clock. Extracted so we can unit-test
// without rendering React + mocking Date globally inside a component.

export function formatBostonTime(d: Date = new Date()): string {
  return d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// Returns the current hour in Boston as 0..23 plus minute fraction (e.g. 14.5
// for 2:30pm). Used by the pond to tint dawn/day/dusk/night.
export function getBostonHourFraction(d: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  // The hour=23 + hour12=false combo can yield "24" on some implementations.
  return ((h % 24) + m / 60);
}
