import { describe, expect, it } from "vitest";
import { NINE_DEFS, RANGE_DEF, buildHole } from "@/components/offhours/golf/course";
import { GH, GW } from "@/components/offhours/golf/green";
import { outsideGreen, terrainOf } from "@/components/offhours/golf/terrain";
import { EXAG_MAX, EXAG_MIN, EXAG_TARGET, designOf, drawnReachOf, reliefOf } from "@/components/golf3d/relief";
import { greenSink } from "@/components/golf3d/green3d";

// The drawn green (relief.ts): its relief about its mean height is drawn K times as tall, full across the putting surface, and an
// apron blends that back into the ground past the collar. Physics is the terrain's (terrain.ts): off the apron the drawn ground is
// the true ground, and what sits on the green is drawn on the drawn surface.

// every green of the course: the nine holes and the range's (its own green, with its own K)
const holes = [...NINE_DEFS, RANGE_DEF].map((d) => buildHole(d));
const C: [number, number] = [GW / 2, GH / 2];
const PUTT_ZONE = -0.85;

describe("the drawn green's shape", () => {
  it("(c) K is 1 beyond the apron: the drawn ground is the true ground there", () => {
    for (const hole of holes) {
      const rel = reliefOf(hole);
      const t = terrainOf(hole);
      const W = designOf(hole).W;
      // a half metre grid: K is 1 by construction past the apron, so a finer one only costs time
      for (let gy = -8; gy <= GH + 8; gy += 0.5)
        for (let gx = -8; gx <= GW + 8; gx += 0.5) {
          if (outsideGreen(hole, gx, gy) < W + 0.01) continue;
          expect(rel.yG(gx, gy), `${hole.def.n} ${gx},${gy}`).toBe(t.yG(gx, gy));
          expect(rel.rise(gx, gy)).toBe(t.rise(gx, gy));
          const [x, z] = hole.fromGreen(gx, gy);
          expect(rel.y(x, z)).toBe(t.y(x, z));
        }
    }
  });

  it("(b) the apron's drawn slope stays under 1:4 (the drawing's own offset, not the ground's)", () => {
    const e = 0.02;
    for (const hole of holes) {
      const rel = reliefOf(hole);
      const t = terrainOf(hole);
      const W = designOf(hole).W;
      const lift = (gx: number, gy: number) => rel.yG(gx, gy) - t.yG(gx, gy);
      // a ray out from the middle, a few directions round the green
      for (let a = 0; a < 6.28; a += 0.2)
        for (let s = 0; s < 16; s += 0.05) {
          const gx = GW / 2 + Math.cos(a) * s, gy = GH / 2 + Math.sin(a) * s;
          const o = outsideGreen(hole, gx, gy);
          if (o <= 0 || o >= W) continue;
          const dx = (lift(gx + e, gy) - lift(gx - e, gy)) / (2 * e);
          const dy = (lift(gx, gy + e) - lift(gx, gy - e)) / (2 * e);
          expect(Math.hypot(dx, dy), `${hole.def.n} a=${a.toFixed(2)} s=${s.toFixed(2)} o=${o.toFixed(2)}`).toBeLessThanOrEqual(0.25);
        }
    }
  });

  it("(b) the apron is on land: no point it lifts is water (K is lowered where a lake is close)", () => {
    for (const hole of holes) {
      const W = designOf(hole).W;
      if (designOf(hole).K === 1) continue;
      for (let gy = -W; gy <= GH + W; gy += 0.25)
        for (let gx = -W; gx <= GW + W; gx += 0.25) {
          const o = outsideGreen(hole, gx, gy);
          if (o <= 0 || o >= W) continue;
          const [x, z] = hole.fromGreen(gx, gy);
          expect(hole.surfaceAt(x, z), `${hole.def.n} ${gx},${gy}`).not.toBe("water");
        }
    }
  });

  it("(a) the drawn slope points the true way at the centre of the green (within 15 degrees)", () => {
    const e = 0.05;
    for (const hole of holes) {
      const rel = reliefOf(hole);
      const t = terrainOf(hole);
      for (let gy = C[1] - 2.5; gy <= C[1] + 2.5; gy += 0.25)
        for (let gx = C[0] - 2.5; gx <= C[0] + 2.5; gx += 0.25) {
          const tx = (t.rise(gx + e, gy) - t.rise(gx - e, gy)) / (2 * e), ty = (t.rise(gx, gy + e) - t.rise(gx, gy - e)) / (2 * e);
          if (Math.hypot(tx, ty) < 0.005) continue;
          const dx = (rel.rise(gx + e, gy) - rel.rise(gx - e, gy)) / (2 * e), dy = (rel.rise(gx, gy + e) - rel.rise(gx, gy - e)) / (2 * e);
          const ang = Math.abs(Math.atan2(dx * ty - dy * tx, dx * tx + dy * ty));
          expect(ang, `${hole.def.n} ${gx},${gy}`).toBeLessThanOrEqual((15 * Math.PI) / 180);
        }
    }
  });

  it("(a) the drawn surface has no interior crown the true one lacks", () => {
    const h = 0.25;
    for (const hole of holes) {
      const rel = reliefOf(hole);
      const t = terrainOf(hole);
      const crowns = (f: (gx: number, gy: number) => number) => {
        const out = new Set<string>();
        for (let gy = 1.5; gy <= GH - 1.5; gy += h)
          for (let gx = 1.5; gx <= GW - 1.5; gx += h) {
            // (inside the putting surface only: the apron's own bumps are not the green's)
            if (outsideGreen(hole, gx, gy) > -1.5) continue;
            const v = f(gx, gy);
            let top = true;
            for (let j = -1; j <= 1 && top; j++)
              for (let i = -1; i <= 1 && top; i++) {
                if (!i && !j) continue;
                if (f(gx + i * h, gy + j * h) >= v) top = false;
              }
            if (top) out.add(`${gx.toFixed(2)},${gy.toFixed(2)}`);
          }
        return out;
      };
      const drawn = crowns((gx, gy) => rel.yG(gx, gy));
      const true_ = crowns((gx, gy) => t.yG(gx, gy));
      for (const k of Array.from(drawn)) expect(true_.has(k), `${hole.def.n} crown at ${k}`).toBe(true);
    }
  });

  it("keeps the green's mean height: the drawn tilt is magnified about the mean, not the middle", () => {
    for (const hole of holes) {
      const rel = reliefOf(hole);
      const t = terrainOf(hole);
      const D = designOf(hole);
      let s = 0, n = 0;
      for (let gy = 0.2; gy < GH; gy += 0.2)
        for (let gx = 0.2; gx < GW; gx += 0.2) {
          if (outsideGreen(hole, gx, gy) > PUTT_ZONE) continue;
          s += rel.rise(gx, gy);
          n++;
        }
      expect(s / n, `${hole.def.n}`).toBeCloseTo(D.c, 6);
      // and the middle is where the true middle is, moved only by K about the mean
      expect(rel.rise(C[0], C[1])).toBeCloseTo(D.c + D.K * (t.rise(C[0], C[1]) - D.c), 9);
    }
  });
});

describe("the drawn green's tilt", () => {
  it("sets each green's K so its drawn 75th-percentile slope is the target, or it is at a clamp", () => {
    const ks: number[] = [];
    for (const hole of holes) {
      const rel = reliefOf(hole);
      const K = designOf(hole).K;
      ks.push(K);
      const slopes: number[] = [];
      const e = 0.1;
      for (let gy = 0.2; gy < GH; gy += 0.2)
        for (let gx = 0.2; gx < GW; gx += 0.2) {
          if (outsideGreen(hole, gx, gy) > PUTT_ZONE) continue;
          const sx = (rel.rise(gx + e, gy) - rel.rise(gx - e, gy)) / (2 * e);
          const sy = (rel.rise(gx, gy + e) - rel.rise(gx, gy - e)) / (2 * e);
          slopes.push(Math.hypot(sx, sy));
        }
      slopes.sort((a, b) => a - b);
      const p75 = slopes[Math.floor(slopes.length * 0.75)];
      // every green is in the band (6 per cent up to the target); a green too flat for it is at the max clamp, with the drawn
      // slope short of the band (the range and hole 9: their true slope is under 1 per cent). A hair over the target is the stencil
      expect(p75, `hole ${hole.def.n} p75 ${p75}`).toBeLessThanOrEqual(EXAG_TARGET + 0.001);
      // (a green whose K a lake lowered is not at the target: the apron has to fit on land)
      if (K !== EXAG_MAX && K !== EXAG_MIN && !designOf(hole).waterLimited && designOf(hole).K !== 1) {
        expect(Math.abs(p75 - EXAG_TARGET), `hole ${hole.def.n} p75 ${p75}`).toBeLessThan(0.001);
      }
      if (K === EXAG_MAX) expect(p75, `hole ${hole.def.n}`).toBeLessThanOrEqual(EXAG_TARGET + 0.001);
      else expect(p75, `hole ${hole.def.n}`).toBeGreaterThanOrEqual(0.06 - 1e-9);
    }
    // one K for every green would not do: the flat green gets more lift than the steep one
    expect(Math.max(...ks)).toBeGreaterThan(Math.min(...ks));
  });
});

describe("what is drawn on the green sits on the drawn surface", () => {
  it("the ball's drawn height on the green is the drawn surface there (the green's own and the course's agree)", () => {
    for (const hole of holes) {
      const rel = reliefOf(hole);
      const t = terrainOf(hole);
      for (let gy = 1; gy < GH; gy += 1.5)
        for (let gx = 1; gx < GW; gx += 1.5) {
          const [x, z] = hole.fromGreen(gx, gy);
          expect(rel.y(x, z)).toBeCloseTo(rel.yG(gx, gy), 9);
          expect(rel.yG(gx, gy)).toBeCloseTo(t.yG(gx, gy) + rel.lift(x, z), 9);
        }
    }
  });

  it("is continuous across the collar's edge: over 2 cm the drawing moves less than 2 cm, on rays out past the edge", () => {
    // (2 cm steps: the same bound as 1 cm, half the samples)
    const d = 0.02;
    for (const hole of holes) {
      const rel = reliefOf(hole);
      const t = terrainOf(hole);
      for (let a = 0; a < 6.28; a += 1.25) {
        const extra = (s: number) => {
          const gx = C[0] + Math.cos(a) * s, gy = C[1] + Math.sin(a) * s;
          return rel.yG(gx, gy) - t.yG(gx, gy);
        };
        // from 2 m in from the middle to 3 m past the rim (every ray's rim is within 10 m of the middle), a centimetre at a time
        let prev = extra(2);
        for (let s = 2 + d; s < 13; s += d) {
          const cur = extra(s);
          expect(Math.abs(cur - prev), `${hole.def.n} a=${a.toFixed(1)} s=${s.toFixed(2)}`).toBeLessThan(0.02);
          prev = cur;
        }
      }
    }
  });
});

describe("the drawn green's box and the terrain under it", () => {
  // the mesh's box is the drawn reach (the bank or the apron, whichever is wider): past it the drawing lifts nothing and the
  // terrain is not sunk, so the edge of the box is no step
  it("lifts and sinks nothing past the drawn box, on every hole", () => {
    for (const hole of holes) {
      const rel = reliefOf(hole);
      const sink = greenSink(hole);
      const R = drawnReachOf(hole);
      for (let gy = -R - 2; gy <= GH + R + 2; gy += 0.5)
        for (let gx = -R - 2; gx <= GW + R + 2; gx += 0.5) {
          if (gx > -R && gx < GW + R && gy > -R && gy < GH + R) continue;
          const [x, z] = hole.fromGreen(gx, gy);
          expect(rel.lift(x, z), `${hole.def.n} ${gx} ${gy}`).toBe(0);
          expect(sink(x, z), `${hole.def.n} ${gx} ${gy}`).toBe(0);
        }
    }
  });
  // where the drawn green dips under the true ground (its low side, and the apron past it), the terrain sinks by at least as much,
  // so the drawn surface is never hidden under the ground: the sink covers the apron's dip, not just the bank
  it("sinks the terrain at least as far as the drawn green dips under it, on every hole", () => {
    for (const hole of holes) {
      const rel = reliefOf(hole);
      const sink = greenSink(hole);
      const R = drawnReachOf(hole);
      for (let gy = -R; gy <= GH + R; gy += 0.25)
        for (let gx = -R; gx <= GW + R; gx += 0.25) {
          const [x, z] = hole.fromGreen(gx, gy);
          if (hole.surfaceAt(x, z) === "water") continue;
          const dip = Math.max(0, -rel.lift(x, z));
          expect(sink(x, z), `${hole.def.n} ${gx.toFixed(2)} ${gy.toFixed(2)}`).toBeGreaterThanOrEqual(dip - 1e-9);
        }
    }
  });
});
