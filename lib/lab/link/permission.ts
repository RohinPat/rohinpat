// iOS 13+ gates DeviceOrientation / DeviceMotion behind a prompt that must be
// raised from a real click (not touchstart). One prompt covers both event types,
// so call this exactly once, as the first thing the click handler does.

export type MotionPermission = "granted" | "denied" | "not-needed";

type Gate = { requestPermission?: () => Promise<"granted" | "denied"> };

export async function askMotionPermission(win: Window = window): Promise<MotionPermission> {
  const w = win as unknown as { DeviceOrientationEvent?: Gate; DeviceMotionEvent?: Gate };
  try {
    // requestPermission() is invoked synchronously, before any await, so it is still inside the click
    if (w.DeviceOrientationEvent && typeof w.DeviceOrientationEvent.requestPermission === "function") {
      return (await w.DeviceOrientationEvent.requestPermission()) === "granted" ? "granted" : "denied";
    }
    if (w.DeviceMotionEvent && typeof w.DeviceMotionEvent.requestPermission === "function") {
      return (await w.DeviceMotionEvent.requestPermission()) === "granted" ? "granted" : "denied";
    }
  } catch {
    return "denied";
  }
  return "not-needed";
}

/** True when this browser has any orientation or motion events at all. */
export function hasMotionApi(win: Window = window): boolean {
  return "DeviceOrientationEvent" in win || "DeviceMotionEvent" in win;
}
