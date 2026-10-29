import { describe, expect, it } from "vitest";
import { AirPointer, aim, angleDiff } from "@/lib/link/pointer";

const DEG = Math.PI / 180;
const o = (alpha: number, beta: number, gamma: number) => ({ seq: 0, t: 0, alpha, beta, gamma, screenAngle: 0 });

describe("aim", () => {
  it("flat with the top edge north is straight ahead", () => {
    const a = aim(o(0, 0, 0));
    expect(a.yaw).toBeCloseTo(0);
    expect(a.pitch).toBeCloseTo(0);
  });

  it("turning right (alpha falls) moves the heading right; tipping the top up raises it", () => {
    expect(aim(o(-20, 0, 0)).yaw / DEG).toBeCloseTo(20);
    expect(aim(o(0, 30, 0)).pitch / DEG).toBeCloseTo(30);
  });

  it("rolling the phone in the hand doesn't move where the top edge points", () => {
    const a = aim(o(0, 0, 40));
    expect(a.yaw).toBeCloseTo(0);
    expect(a.pitch).toBeCloseTo(0);
  });

  it("wraps headings across north", () => {
    expect(angleDiff(179 * DEG, -179 * DEG) / DEG).toBeCloseTo(-2);
  });
});

describe("AirPointer", () => {
  it("centres on the first sample and maps reach degrees across the width", () => {
    const p = new AirPointer({ reach: 40, minCutoff: 1, beta: 0 });
    p.push(o(0, 0, 0));
    expect(p.position(1000, 600, 0)).toEqual({ x: 500, y: 300 });
    p.push(o(-10, 5, 0)); // 10° right, 5° up
    p.center(); // forget the filter so the next position is the raw mapping...
    p.push(o(-10, 5, 0));
    expect(p.position(1000, 600, 16)).toEqual({ x: 500, y: 300 }); // ...and that pose is now the middle
    p.push(o(-20, 5, 0)); // another 10° right = a quarter of 40°
    const q = p.position(1000, 600, 2000)!;
    expect(q.x).toBeGreaterThan(500);
    expect(q.x).toBeLessThanOrEqual(750);
  });
});
