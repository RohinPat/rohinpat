import * as THREE from "three";
import type { RGB } from "./types";

// Hole 9's clubhouse: the last building of the round, standing on the headland behind the green. One merged geometry in
// metres (the ground at y = 0, sunk a metre), vertex colours shaded by the sun once, so it is one draw call and about
// 150 triangles. The front (the long side with the lit windows and the veranda) faces -z, back toward the course.

const c3 = (hex: string): RGB => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

export const CLUBHOUSE_W = 26, CLUBHOUSE_D = 10;

export function clubhouseGeometry(sun: [number, number, number]): { geometry: THREE.BufferGeometry; tris: number } {
  const wall = c3("#eee4cf"), wallSide = c3("#e3d6bb"), roof = c3("#8c3d35"), roofDark = c3("#6f302c"), deck = c3("#b8a888"), post = c3("#f4efe4");
  const glow = c3("#ffd57e"), door = c3("#5a3b2c"), stone = c3("#a79c8a"), flag = c3("#c4413a"), pole = c3("#f4efe4");
  const sl = Math.hypot(sun[0], sun[1], sun[2]) || 1;
  const L: RGB = [sun[0] / sl, sun[1] / sl, sun[2] / sl];
  const pos: number[] = [], col: number[] = [];
  const tri = (a: RGB, b: RGB, c: RGB, base: RGB, lit = true) => {
    let k = 1;
    if (lit) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      k = 0.62 + 0.5 * Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / nl);
    }
    for (const p of [a, b, c]) {
      pos.push(p[0], p[1], p[2]);
      col.push(base[0] * k, base[1] * k, base[2] * k);
    }
  };
  /** a quad a-b-c-d (in order round it), two triangles, double-sided by drawing both windings */
  const quad = (a: RGB, b: RGB, c: RGB, d: RGB, base: RGB, lit = true) => {
    tri(a, b, c, base, lit);
    tri(a, c, d, base, lit);
    tri(a, c, b, base, lit);
    tri(a, d, c, base, lit);
  };
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, base: RGB, side = base) => {
    quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], base);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], base);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], side);
    quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], side);
    quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], deck);
  };
  const w = CLUBHOUSE_W / 2, d = CLUBHOUSE_D / 2;
  const H = 5.2;
  // the footing, the hall, the veranda deck in front
  box(-w - 0.6, -1, -d - 0.6, w + 0.6, 0.5, d + 0.6, stone);
  box(-w, 0.5, -d, w, H, d, wall, wallSide);
  // the roof: a hip, a ridge along x
  const ov = 0.9, ridge = 3.4, rl = w * 0.62;
  const e0: RGB = [-w - ov, H, -d - ov], e1: RGB = [w + ov, H, -d - ov], e2: RGB = [w + ov, H, d + ov], e3: RGB = [-w - ov, H, d + ov];
  const r0: RGB = [-rl, H + ridge, 0], r1: RGB = [rl, H + ridge, 0];
  quad(e0, e1, r1, r0, roof);
  quad(e2, e3, r0, r1, roofDark);
  tri(e3, e0, r0, roof);
  tri(e1, e2, r1, roofDark);
  tri(e3, r0, e0, roof);
  tri(e2, r1, e1, roofDark);
  // a chimney
  box(w * 0.45, H + 0.5, -0.4, w * 0.45 + 1.4, H + ridge + 1.6, 1.0, stone);
  // the veranda: a deck, posts and a low roof, along the front (the -z side)
  box(-w + 2, 0.5, -d - 4.2, w - 2, 1.0, -d, deck);
  for (let i = 0; i <= 6; i++) {
    const x = -w + 2.4 + (i * (CLUBHOUSE_W - 4.8)) / 6;
    box(x - 0.18, 1.0, -d - 4.0, x + 0.18, 4.0, -d - 3.64, post);
  }
  quad([-w + 1.6, 4.0, -d - 4.4], [w - 1.6, 4.0, -d - 4.4], [w - 1.6, 4.5, -d - 0.2], [-w + 1.6, 4.5, -d - 0.2], roofDark);
  // lit windows on the front and the back, and a door in the middle of the front
  for (let i = 0; i < 7; i++) {
    const x = -w + 2.2 + (i * (CLUBHOUSE_W - 4.4)) / 6;
    if (i === 3) continue;
    quad([x - 0.7, 1.8, -d - 0.05], [x + 0.7, 1.8, -d - 0.05], [x + 0.7, 3.8, -d - 0.05], [x - 0.7, 3.8, -d - 0.05], glow, false);
    quad([x - 0.7, 1.8, d + 0.05], [x + 0.7, 1.8, d + 0.05], [x + 0.7, 3.8, d + 0.05], [x - 0.7, 3.8, d + 0.05], glow, false);
  }
  quad([-0.9, 0.5, -d - 0.06], [0.9, 0.5, -d - 0.06], [0.9, 3.4, -d - 0.06], [-0.9, 3.4, -d - 0.06], door);
  // a flagpole beside it, with a flag
  const fx = w + 5, fz = -d;
  box(fx - 0.08, -0.5, fz - 0.08, fx + 0.08, 12, fz + 0.08, pole);
  quad([fx, 11.8, fz], [fx + 2.6, 11.4, fz], [fx + 2.6, 10, fz], [fx, 10.2, fz], flag, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
  return { geometry: g, tris: pos.length / 9 };
}
