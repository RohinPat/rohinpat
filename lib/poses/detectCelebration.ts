// Pure celebration detector for /play's PoseCelebrate. Pose keypoints in,
// celebration descriptor out. Tested independently of TF.js.

export type Keypoint = {
  x: number;
  y: number;
  score: number;
  name?: string;
};

export type PoseKey = "wide" | "up" | "point" | "fist" | "heart";

export type Detected = {
  key: PoseKey;
  label: string;
  flavor: string;
};

const MIN_SCORE = 0.3;

function kpByName(kps: readonly Keypoint[]): Record<string, Keypoint> {
  const m: Record<string, Keypoint> = {};
  for (const k of kps) if (k.name) m[k.name] = k;
  return m;
}

/**
 * Detect any of several goal celebrations from a single pose.
 * Designed to work seated at a laptop — only requires head + shoulders + wrists.
 * Returns the most specific match if multiple apply.
 */
export function detectCelebration(kps: readonly Keypoint[]): Detected | null {
  const m = kpByName(kps);
  const need = ["left_shoulder", "right_shoulder", "left_wrist", "right_wrist", "nose"];
  for (const k of need) {
    if (!m[k] || m[k].score < MIN_SCORE) return null;
  }
  const ls = m.left_shoulder!, rs = m.right_shoulder!;
  const lw = m.left_wrist!, rw = m.right_wrist!;
  const nose = m.nose!;

  const shoulderY = (ls.y + rs.y) / 2;
  const shoulderSpread = Math.abs(ls.x - rs.x) || 60;
  const headY = nose.y;

  const leftAboveHead = lw.y < headY - 10;
  const rightAboveHead = rw.y < headY - 10;
  const leftAboveShoulder = lw.y < shoulderY - 10;
  const rightAboveShoulder = rw.y < shoulderY - 10;

  // HEART hands: both wrists near each other above shoulders.
  const wristDistance = Math.hypot(lw.x - rw.x, lw.y - rw.y);
  if (leftAboveShoulder && rightAboveShoulder && wristDistance < shoulderSpread * 0.55) {
    return { key: "heart", label: "Heart hands", flavor: "for the curva sud" };
  }

  // ARMS WIDE (Messi): both wrists above shoulders, spread wider than shoulders.
  const wristSpread = Math.abs(lw.x - rw.x);
  if (leftAboveShoulder && rightAboveShoulder && wristSpread > shoulderSpread * 1.15) {
    return { key: "wide", label: "Arms wide", flavor: "Messi style" };
  }

  // BOTH ARMS UP: both wrists above head.
  if (leftAboveHead && rightAboveHead) {
    return { key: "up", label: "Both arms up", flavor: "pure jubilation" };
  }

  // POINT TO SKY: one wrist way above head, other low.
  const oneFar =
    (leftAboveHead && !rightAboveShoulder) ||
    (rightAboveHead && !leftAboveShoulder);
  if (oneFar) {
    return { key: "point", label: "Point to the sky", flavor: "for someone watching" };
  }

  // FIST PUMP: one wrist between shoulder and head, other low.
  const leftFist =
    lw.y < shoulderY - 10 && lw.y > headY - 40 && !rightAboveShoulder;
  const rightFist =
    rw.y < shoulderY - 10 && rw.y > headY - 40 && !leftAboveShoulder;
  if (leftFist || rightFist) {
    return { key: "fist", label: "Fist pump", flavor: "Eto'o energy" };
  }

  return null;
}
