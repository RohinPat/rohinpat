// The camera as the renderer sees it: where it is, which way it points, and the
// numbers that turn a point in the world into a point on the canvas. A single
// shared result (`P`) is written by `project`, so projecting a point allocates
// nothing; the road, the car and the particles all go through it.

export type View = {
  w: number;
  h: number;
  /** focal length, px */
  f: number;
  w2: number;
  /** the horizon, px from the top */
  hy: number;
  camX: number;
  camY: number;
  camZ: number;
  sinG: number;
  cosG: number;
};

export const newView = (): View => ({ w: 0, h: 0, f: 1, w2: 0, hy: 0, camX: 0, camY: 0, camZ: 0, sinG: 0, cosG: 1 });

/** the last projected point: screen x, y and the depth (m) in front of the camera */
export const P = { x: 0, y: 0, z: 0 };

/** A world point to the screen, written into P. False if it is behind the camera. */
export function project(v: View, wx: number, wy: number, wz: number): boolean {
  const dx = wx - v.camX;
  const dz = wz - v.camZ;
  const z = dx * v.sinG + dz * v.cosG;
  if (z < 0.35) return false;
  const xc = dx * v.cosG - dz * v.sinG;
  P.x = v.w2 + (v.f * xc) / z;
  P.y = v.hy - (v.f * (wy - v.camY)) / z;
  P.z = z;
  return true;
}
