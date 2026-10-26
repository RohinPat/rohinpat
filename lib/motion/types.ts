// Shared types for the swing lab recognisers.
//
// Everything here is plain data in SI units so the recognisers are pure
// functions of a sample stream: no DOM, no timers, no globals. The recorder
// page converts browser events into these shapes; the unit tests feed them
// from a synthetic physics generator; recorded JSON files can be replayed
// through them later.

export type Vec3 = [number, number, number];

/** DeviceOrientation angles in degrees (W3C ZXY convention). */
export interface OrientationAngles {
  alpha: number;
  beta: number;
  gamma: number;
}

/**
 * One DeviceMotion sample, in the device frame (x right, y toward the top of
 * the screen, z out of the screen), SI units.
 */
export interface MotionSample {
  /** Seconds, monotonic. Only differences matter. */
  t: number;
  /** accelerationIncludingGravity, m/s^2. At rest it points UP with |a| ~ 9.81. */
  acc: Vec3;
  /** acceleration (gravity removed by the OS fusion), m/s^2, when the browser gives it. */
  lin?: Vec3;
  /** rotationRate in rad/s about device x (browser "beta"), y ("gamma"), z ("alpha"). */
  gyro: Vec3;
  /** DeviceOrientation, degrees, when available. */
  orient?: OrientationAngles;
}

export interface TouchPoint {
  /** Seconds. */
  t: number;
  /** CSS pixels, y grows downward. */
  x: number;
  y: number;
}

export type DetectorOutput<E> =
  | { kind: "event"; event: E }
  | { kind: "reject"; t: number; gesture: string; reason: string; detail?: string };

/** A streaming recogniser: feed samples in order, collect zero or more outputs per sample. */
export interface Detector<In, E> {
  push(sample: In): DetectorOutput<E>[];
  reset(): void;
}

/** Run a detector over a whole recording and collect everything it emits. */
export function runDetector<In, E>(det: Detector<In, E>, samples: readonly In[]): DetectorOutput<E>[] {
  const out: DetectorOutput<E>[] = [];
  for (const s of samples) out.push(...det.push(s));
  return out;
}

export function eventsOf<E>(outputs: readonly DetectorOutput<E>[]): E[] {
  const ev: E[] = [];
  for (const o of outputs) if (o.kind === "event") ev.push(o.event);
  return ev;
}
