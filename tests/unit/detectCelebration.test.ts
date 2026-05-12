import { describe, it, expect } from "vitest";
import { detectCelebration, type Keypoint } from "@/lib/poses/detectCelebration";

// Build a fake pose. Shoulders centered at y=200, ~120px apart.
// Head/nose at y=160. Wrists positioned per test.
function pose(opts: {
  leftWristX: number;
  leftWristY: number;
  rightWristX: number;
  rightWristY: number;
  noseY?: number;
  shoulderY?: number;
  scores?: number;
}): Keypoint[] {
  const score = opts.scores ?? 0.9;
  const shoulderY = opts.shoulderY ?? 200;
  const noseY = opts.noseY ?? 160;
  return [
    { name: "nose", x: 320, y: noseY, score },
    { name: "left_shoulder", x: 380, y: shoulderY, score },
    { name: "right_shoulder", x: 260, y: shoulderY, score },
    { name: "left_wrist", x: opts.leftWristX, y: opts.leftWristY, score },
    { name: "right_wrist", x: opts.rightWristX, y: opts.rightWristY, score },
  ];
}

describe("detectCelebration", () => {
  it("returns null when keypoints are missing", () => {
    expect(detectCelebration([])).toBe(null);
  });

  it("returns null when scores are too low", () => {
    const kps = pose({
      leftWristX: 480, leftWristY: 100,
      rightWristX: 160, rightWristY: 100,
      scores: 0.1,
    });
    expect(detectCelebration(kps)).toBe(null);
  });

  it("detects arms wide (wrists above shoulders, spread wider)", () => {
    const kps = pose({
      leftWristX: 520, leftWristY: 140,
      rightWristX: 120, rightWristY: 140,
    });
    expect(detectCelebration(kps)?.key).toBe("wide");
  });

  it("detects both arms up (above head, not wide)", () => {
    const kps = pose({
      leftWristX: 360, leftWristY: 80,
      rightWristX: 280, rightWristY: 80,
    });
    expect(detectCelebration(kps)?.key).toBe("up");
  });

  it("detects point to sky (one wrist above head, other low)", () => {
    const kps = pose({
      leftWristX: 380, leftWristY: 60,
      rightWristX: 260, rightWristY: 280,
    });
    expect(detectCelebration(kps)?.key).toBe("point");
  });

  it("detects fist pump (one wrist between shoulder and head)", () => {
    const kps = pose({
      leftWristX: 380, leftWristY: 175,
      rightWristX: 260, rightWristY: 280,
    });
    expect(detectCelebration(kps)?.key).toBe("fist");
  });

  it("detects heart hands (both wrists above shoulders, close together)", () => {
    const kps = pose({
      leftWristX: 330, leftWristY: 150,
      rightWristX: 310, rightWristY: 150,
    });
    expect(detectCelebration(kps)?.key).toBe("heart");
  });

  it("returns null for a relaxed pose (arms at sides)", () => {
    const kps = pose({
      leftWristX: 400, leftWristY: 320,
      rightWristX: 240, rightWristY: 320,
    });
    expect(detectCelebration(kps)).toBe(null);
  });

  it("prefers heart over wide when wrists are close even if technically wide", () => {
    // Heart check runs first
    const kps = pose({
      leftWristX: 330, leftWristY: 150,
      rightWristX: 310, rightWristY: 150,
    });
    expect(detectCelebration(kps)?.key).toBe("heart");
  });

  it("returns label and flavor for each detected pose", () => {
    const wideKps = pose({
      leftWristX: 520, leftWristY: 140,
      rightWristX: 120, rightWristY: 140,
    });
    const res = detectCelebration(wideKps);
    expect(res?.label).toBe("Arms wide");
    expect(res?.flavor).toBe("Messi style");
  });
});
