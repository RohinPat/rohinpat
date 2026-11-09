import { describe, expect, it } from "vitest";
import { CLUBS } from "@/components/offhours/golf/flight";
import { ballLocal, golferFrame, golferJoints, poseFor } from "@/components/offhours/golf/golfer";

// The golfer's joints are shared by the 2D course and the 3D one (components/golf3d), so they are a function of their
// own. At address the club head sits at the ball, for every club; the frame puts the ball where the game has it.

describe("the golfer's joints", () => {
  it("at address, the club head is at the ball for every club", () => {
    for (const club of CLUBS) {
      const j = golferJoints(poseFor({ kind: "back", u: 0 }, club), club);
      const b = ballLocal(club);
      expect(Math.hypot(j.clubHead[0] - b[0], j.clubHead[1] - b[1], j.clubHead[2] - b[2])).toBeLessThan(0.03);
    }
  });

  it("the frame stands the golfer beside the ball, facing the aim", () => {
    const club = CLUBS[0];
    const yaw = 0.4;
    const ball: [number, number, number] = [12, 0, 80];
    const { origin, ex, ez } = golferFrame(ball, yaw, club);
    const b = ballLocal(club);
    // the ball in the local frame maps back to where it lies
    expect(origin[0] + ex[0] * b[0] + ez[0] * b[2]).toBeCloseTo(ball[0], 6);
    expect(origin[2] + ex[2] * b[0] + ez[2] * b[2]).toBeCloseTo(ball[2], 6);
    // Z points down the aim
    expect(Math.atan2(ez[0], ez[2])).toBeCloseTo(yaw, 6);
  });

  it("at the top of the backswing the hands and the club head are high", () => {
    const club = CLUBS[3];
    const j = golferJoints(poseFor({ kind: "back", u: 1 }, club), club);
    expect(j.handL[1]).toBeGreaterThan(1.4);
    expect(j.clubHead[1]).toBeGreaterThan(1.2);
  });
});
