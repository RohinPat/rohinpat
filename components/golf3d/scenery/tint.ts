import * as THREE from "three";
import { clamp, noise1, signedDist, smooth } from "./geo";
import { vnoise } from "./ridged";
import type { RGB, SceneryRecord } from "./types";

// The terrain's texture stops at the edge of the painted box and is clamped, so out on the hills every texel is the
// "deep" green and what shows is texel x vertex colour. To paint a hill a given colour the vertex colour is therefore
// the ratio target / texel (in linear light). The original hill tint is the scene with no palette.

const lin = (hex: string): RGB => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

export function makeTint(rec: SceneryRecord, beyond: (x: number, z: number) => number) {
  const P = rec.palette;
  if (!P) {
    return (_x: number, _z: number, y: number, groundY: number, _texel: string, out: RGB) => {
      const u = Math.max(0, Math.min(1, (y - groundY) / 30));
      out[0] = 1 + u * 0.55;
      out[1] = 1 + u * 0.6;
      out[2] = 1 + u * 0.25;
    };
  }
  const base = lin(P.base), high = lin(P.high);
  const reach = P.reach ?? 30;
  // never before the gate, whatever the scene says
  const r0 = Math.max(30, P.ramp?.[0] ?? 30), r1 = Math.max(r0 + 1, P.ramp?.[1] ?? 90);
  const coast = rec.coast;
  const patch = P.patches ? { c: lin(P.patches.color), share: clamp(P.patches.share, 0, 1), f: 1 / (P.patches.scale ?? 70), seed: P.patches.seed ?? 3 } : null;
  const rock = coast?.cliff ? coast.cliff.rock.map(lin) : [];
  const rockFoot = coast?.cliff ? lin(coast.cliff.foot) : base;
  let texelKey = "", tex: RGB = [1, 1, 1];
  const ratio = (target: number, i: number) => target / Math.max(tex[i], 0.02);
  return (x: number, z: number, y: number, groundY: number, texel: string, out: RGB) => {
    const w = smooth(r0, r1, beyond(x, z));
    if (w <= 0) {
      out[0] = out[1] = out[2] = 1;
      return;
    }
    if (texel !== texelKey) {
      texelKey = texel;
      tex = lin(texel);
    }
    const u = clamp((y - groundY) / reach, 0, 1);
    // blotches of a second colour where a slow noise rises past its share, a little paler up high
    const pa = patch ? smooth(0.66 - patch.share * 0.45, 0.75 - patch.share * 0.45, 0.62 * vnoise(x * patch.f, z * patch.f, patch.seed) + 0.38 * vnoise(x * patch.f * 2.7 + 9, z * patch.f * 2.7 + 4, patch.seed + 1)) : 0;
    for (let i = 0; i < 3; i++) {
      const ground = base[i] + (high[i] - base[i]) * u;
      out[i] = 1 + (ratio(patch ? ground + (patch.c[i] - ground) * pa : ground, i) - 1) * w;
    }
    if (coast && rock.length) {
      // the drop to the water is rock: bands by height over the sea, darker at the foot
      const sd = signedDist(coast, x, z);
      const r = smooth(-1, 3, sd);
      if (r > 0) {
        const up = y - coast.seaY;
        const band = Math.floor(up / 5 + 1.2 * noise1(x * 0.03 + z * 0.027, 3) + 100) % rock.length;
        const foot = 1 - smooth(2, 9, up);
        for (let i = 0; i < 3; i++) {
          const c = rock[band][i] + (rockFoot[i] - rock[band][i]) * foot;
          out[i] += (ratio(c, i) - out[i]) * r;
        }
      }
    }
  };
}
