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
