// iOS 13+ gates DeviceOrientation behind a prompt that must be raised from a
// real click, and only once. Call this as the very first statement of the
// click handler: the requestPermission() call below happens synchronously,
// before anything awaits, so it is still inside the user's gesture.

export type Motion = "granted" | "denied" | "not-needed" | "unavailable";

type Gate = { requestPermission?: () => Promise<"granted" | "denied"> };

export function askMotionPermission(win: Window = window): Promise<Motion> {
  const w = win as unknown as { DeviceOrientationEvent?: Gate; DeviceMotionEvent?: Gate };
  if (!("DeviceOrientationEvent" in win) && !("DeviceMotionEvent" in win)) return Promise.resolve("unavailable");
  try {
    const gate = w.DeviceOrientationEvent?.requestPermission
      ? w.DeviceOrientationEvent
      : w.DeviceMotionEvent?.requestPermission
        ? w.DeviceMotionEvent
        : null;
    if (gate?.requestPermission) {
      return gate.requestPermission().then(
        (r) => (r === "granted" ? "granted" : "denied"),
        () => "denied",
      );
    }
  } catch {
    return Promise.resolve("denied");
  }
  return Promise.resolve("not-needed");
}
