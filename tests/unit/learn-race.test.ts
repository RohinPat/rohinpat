import { afterEach, describe, expect, it } from "vitest";
import { NightGame, setRival } from "@/components/offhours/night/game";
import { createRecorder, newPose, timeAt, type Ghost } from "@/components/offhours/night/ghost";
import { getTarget } from "@/components/offhours/night/target";

/** a car that drives straight down the road at 20 m/s for a couple of minutes */
function learner(): Ghost {
  const rec = createRecorder(200);
  const p = newPose();
  for (let k = 0; k <= 120 * 20; k++) {
    p.s = 12 + k;
    p.speed = 20;
    rec.push(k / 20, p);
  }
  return rec.snapshot(120, false);
}

function runFor(g: NightGame, secs: number) {
  for (let t = 0; t < secs; t += 1 / 60) g.update(1 / 60, { steer: 0, throttle: 0.6, brake: 0, hand: 0 });
}

describe("Race it: the learner is the ghost", () => {
  afterEach(() => setRival(null));

  it("takes the ghost's place, and the gap box measures against it", () => {
    const ghost = learner();
    setRival(ghost);
    const g = new NightGame(true);
    g.start();
    runFor(g, 6);
    expect(g.phase).toBe("run");
    // the pilot's rival is not drawn; the learner is, as the one you are racing
    expect(g.scene.ghosts[0].show).toBe(false);
    expect(g.scene.ghosts[1].show).toBe(true);
    expect(g.scene.ghosts[1].kind).toBe(3);
    // the gap is the clock against the learner's time at this point of the road
    const at = timeAt(ghost, g.car.s);
    expect(at).not.toBeNull();
    expect(g.deltaS).toBeCloseTo(g.clock - (at as number), 1);
  });

  it("is the pilot's rival again once the learner is cleared", () => {
    setRival(learner());
    setRival(null);
    const g = new NightGame(true);
    g.start();
    runFor(g, 6);
    expect(g.scene.ghosts[0].show).toBe(true);
    expect(g.scene.ghosts[1].kind).toBe(1);
    const at = timeAt(getTarget().rival, g.car.s);
    expect(g.deltaS).toBeCloseTo(g.clock - (at as number), 1);
  });
});
