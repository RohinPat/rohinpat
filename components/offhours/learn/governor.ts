import { ENGINE_CAL } from "../engineRemote";

// The Night run's quality governor, on its own: a slow second and a half drops
// one level of scenery (0 everything, 3 the bare road with its lamps), and a long
// smooth spell climbs back. With two dozen ghosts on the road the frames cost a
// little more than a player's run, so it matters more here.

export type Governor = { level: number; ema: number; slowFor: number; fastFor: number };

export const newGovernor = (): Governor => ({ level: 0, ema: 16.7, slowFor: 0, fastFor: 0 });

export function stepGovernor(q: Governor, dt: number) {
  if (dt <= 0) return;
  const C = ENGINE_CAL.cam;
  q.ema += (dt * 1000 - q.ema) * 0.06;
  if (q.ema > C.slowFrameMs) {
    q.slowFor += dt;
    q.fastFor = 0;
  } else if (q.ema < C.fastFrameMs) {
    q.fastFor += dt;
    q.slowFor = 0;
  } else {
    q.slowFor = 0;
    q.fastFor = 0;
  }
  if (q.slowFor > 1.5 && q.level < 3) {
    q.level++;
    q.slowFor = 0;
    q.ema = 16.7;
  } else if (q.fastFor > 10 && q.level > 0) {
    q.level--;
    q.fastFor = 0;
  }
}
