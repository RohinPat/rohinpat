import { seeded } from "@/components/offhours/useCanvas";
import type { AreaKind, AreaM } from "@/components/offhours/golf/course";

// The hole's areas (fescue, gorse, waste, out of bounds) painted into the ground texture. Every kind is meant to read
// from the tee as a different colour and up close as a different texture:
//   fescue  tawny wisps of long grass, a pale soft edge into the rough
//   gorse   dark green bushes in overlapping clumps with yellow flowers
//   waste   pale sand with darker hummock shading, tufts of scrub and a few stones
//   oob     a dim, hatched ground with the white boundary line (the stakes are the props builder's)
// Paint only: where the ball plays comes from course.ts surfaceAt, which reads the same outlines.

export const AREA_COL = {
  fescueA: "#b9a55c",
  fescueB: "#d8c883",
  fescueC: "#8f8240",
  fescueEdge: "rgba(168,156,84,0.55)",
  gorseA: "#2a5428",
  gorseB: "#1d4020",
  gorseC: "#3f7c35",
  gorseFlower: "#f3d233",
  gorseFlowerB: "#ffe866",
  wasteA: "#e4d3a0",
  wasteB: "#d2bd86",
  wasteC: "#f1e6c0",
  wasteTuft: "#9a9a58",
  wasteTuftB: "#7f8a48",
  wasteEdge: "rgba(205,190,135,0.6)",
  oobA: "#33503a",
  oobHatch: "rgba(10,28,16,0.38)",
  oobLine: "#f6f6ee",
};

type P = [number, number];

const KIND_SEED: Record<AreaKind, number> = { fescue: 1, gorse: 2, waste: 3, oob: 4 };

/**
 * Paint `areas` onto `c`. `tx`/`tz` map the hole's metres to canvas pixels and `s` is pixels per metre. Called after the
 * fairway and before the sand and water, so a bunker or pond in a field stays on top.
 */
export function paintAreas(c: CanvasRenderingContext2D, areas: AreaM[], tx: (x: number) => number, tz: (z: number) => number, s: number, seed: number) {
  const path = (pts: P[]) => {
    c.beginPath();
    pts.forEach(([x, z], i) => (i ? c.lineTo(tx(x), tz(z)) : c.moveTo(tx(x), tz(z))));
    c.closePath();
  };
  areas.forEach((a, ai) => {
    const r = seeded(seed * 31 + KIND_SEED[a.kind] * 977 + ai * 53);
    const xs = a.ring.map((p) => p[0]), zs = a.ring.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const w = x1 - x0, h = z1 - z0;
    const area = w * h;
    c.save();
    c.lineJoin = "round";
    c.lineCap = "round";
    const at = (): P => [x0 + r() * w, z0 + r() * h];
    switch (a.kind) {
      case "fescue": {
        // a pale soft edge first, so the field fades into the rough
        path(a.ring);
        c.strokeStyle = AREA_COL.fescueEdge;
        c.lineWidth = 2.4 * s;
        c.stroke();
        c.fillStyle = AREA_COL.fescueA;
        c.fill();
        c.clip();
        // patches of lighter and darker straw
        for (let i = 0; i < area / 9; i++) {
          const [x, z] = at();
          c.fillStyle = r() > 0.5 ? "rgba(216,200,131,0.35)" : "rgba(120,104,50,0.28)";
          c.beginPath();
          c.ellipse(tx(x), tz(z), (0.8 + r() * 1.8) * s, (0.6 + r() * 1.2) * s, r() * 3.14, 0, 6.3);
          c.fill();
        }
        // wisps: thin curved strokes, mostly leaning the same way, in three straws
        const cols = [AREA_COL.fescueB, AREA_COL.fescueC, AREA_COL.fescueA, "#e9dc9e"];
        c.lineWidth = Math.max(1, 0.05 * s);
        for (let i = 0; i < area * 7; i++) {
          const [x, z] = at();
          const ang = -1.2 + (r() - 0.5) * 1.9, len = (0.45 + r() * 1.0) * s;
          const bx = tx(x), bz = tz(z);
          c.strokeStyle = cols[i & 3];
          c.beginPath();
          c.moveTo(bx, bz);
          c.quadraticCurveTo(bx + Math.cos(ang) * len * 0.5 + (r() - 0.5) * len * 0.4, bz + Math.sin(ang) * len * 0.5, bx + Math.cos(ang) * len, bz + Math.sin(ang) * len);
          c.stroke();
        }
        break;
      }
      case "gorse": {
        // a ragged skirt of dark, then clumps of bush piled up, each lighter on its sunny side
        path(a.ring);
        c.strokeStyle = "rgba(30,64,32,0.7)";
        c.lineWidth = 2.2 * s;
        c.stroke();
        c.fillStyle = AREA_COL.gorseB;
        c.fill();
        c.save();
        c.clip();
        const clump = (x: number, z: number, rad: number) => {
          const px = tx(x), pz = tz(z);
          c.fillStyle = AREA_COL.gorseB;
          c.beginPath();
          c.arc(px + rad * 0.12 * s, pz + rad * 0.16 * s, rad * s, 0, 6.3);
          c.fill();
          c.fillStyle = r() > 0.4 ? AREA_COL.gorseA : AREA_COL.gorseC;
          c.beginPath();
          c.arc(px, pz, rad * 0.88 * s, 0, 6.3);
          c.fill();
          c.fillStyle = "rgba(112,168,72,0.45)";
          c.beginPath();
          c.arc(px - rad * 0.25 * s, pz - rad * 0.3 * s, rad * 0.45 * s, 0, 6.3);
          c.fill();
        };
        for (let i = 0; i < area / 2.2; i++) {
          const [x, z] = at();
          clump(x, z, 0.5 + r() * 0.9);
        }
        c.restore();
        // the bushes along the edge spill over it
        for (let i = 0; i < a.ring.length; i++) {
          const [ax, az] = a.ring[i], [bx, bz] = a.ring[(i + 1) % a.ring.length];
          const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 1.2));
          for (let k = 0; k < n; k++) {
            const u = k / n;
            clump(ax + (bx - ax) * u + (r() - 0.5) * 0.8, az + (bz - az) * u + (r() - 0.5) * 0.8, 0.45 + r() * 0.45);
          }
        }
        // flowers: bright yellow dots in small drifts
        c.save();
        path(a.ring);
        c.clip();
        for (let i = 0; i < area / 3; i++) {
          const [cx, cz] = at();
          const n = 2 + Math.floor(r() * 5);
          for (let k = 0; k < n; k++) {
            c.fillStyle = r() > 0.35 ? AREA_COL.gorseFlower : AREA_COL.gorseFlowerB;
            c.beginPath();
            c.arc(tx(cx + (r() - 0.5) * 1.1), tz(cz + (r() - 0.5) * 1.1), Math.max(0.8, (0.07 + r() * 0.09) * s), 0, 6.3);
            c.fill();
          }
        }
        c.restore();
        break;
      }
      case "waste": {
        path(a.ring);
        c.strokeStyle = AREA_COL.wasteEdge;
        c.lineWidth = 2 * s;
        c.stroke();
        c.fillStyle = AREA_COL.wasteA;
        c.fill();
        c.clip();
        // hummocks: a dark shadow side and a pale lit side, so the sand rolls
        for (let i = 0; i < area / 22; i++) {
          const [x, z] = at();
          const rx = (1.4 + r() * 2.8) * s, rz = (1 + r() * 1.8) * s;
          const px = tx(x), pz = tz(z);
          c.fillStyle = "rgba(168,140,84,0.32)";
          c.beginPath();
          c.ellipse(px + rx * 0.18, pz + rz * 0.3, rx, rz, 0, 0, 6.3);
          c.fill();
          c.fillStyle = "rgba(246,236,200,0.5)";
          c.beginPath();
          c.ellipse(px - rx * 0.12, pz - rz * 0.2, rx * 0.8, rz * 0.7, 0, 0, 6.3);
          c.fill();
        }
        // patches of firmer, darker sand
        for (let i = 0; i < area / 14; i++) {
          const [x, z] = at();
          c.fillStyle = AREA_COL.wasteB + "66";
          c.beginPath();
          c.ellipse(tx(x), tz(z), (0.5 + r() * 1.2) * s, (0.4 + r() * 0.8) * s, r() * 3.14, 0, 6.3);
          c.fill();
        }
        // wind ripples: long faint arcs across the sand, pale on the ridge and dark in the trough
        c.lineWidth = Math.max(1, 0.05 * s);
        for (let i = 0; i < area / 7; i++) {
          const [x, z] = at();
          const px = tx(x), pz = tz(z), len = (0.8 + r() * 1.8) * s, bend = (r() - 0.5) * 0.5 * s;
          c.strokeStyle = r() > 0.5 ? "rgba(250,242,208,0.5)" : "rgba(150,124,74,0.32)";
          c.beginPath();
          c.moveTo(px, pz);
          c.quadraticCurveTo(px + len * 0.5, pz + bend, px + len, pz + bend * 0.3);
          c.stroke();
        }
        // scrub: soft dabs of grey-green and dry straw, in twos and threes (the bushes stand over the biggest: scrub3d.ts)
        for (let i = 0; i < area / 3.2; i++) {
          const [x, z] = at();
          const px = tx(x), pz = tz(z), n = 1 + Math.floor(r() * 3);
          for (let k = 0; k < n; k++) {
            const rad = (0.1 + r() * 0.2) * s;
            const ox = (r() - 0.5) * 0.5 * s, oz = (r() - 0.5) * 0.4 * s;
            c.fillStyle = "rgba(96,92,52,0.28)";
            c.beginPath();
            c.ellipse(px + ox + rad * 0.3, pz + oz + rad * 0.25, rad * 1.1, rad * 0.8, 0, 0, 6.3);
            c.fill();
            c.fillStyle = r() > 0.35 ? AREA_COL.wasteTuft : r() > 0.5 ? AREA_COL.wasteTuftB : "#c9b56e";
            c.beginPath();
            c.ellipse(px + ox, pz + oz, rad, rad * 0.75, 0, 0, 6.3);
            c.fill();
          }
        }
        for (let i = 0; i < area / 5; i++) {
          const [x, z] = at();
          c.fillStyle = r() > 0.5 ? AREA_COL.wasteC : "rgba(120,100,60,0.55)";
          c.fillRect(tx(x), tz(z), Math.max(1, 0.1 * s), Math.max(1, 0.07 * s));
        }
        break;
      }
      case "oob": {
        path(a.ring);
        c.fillStyle = AREA_COL.oobA;
        c.fill();
        c.clip();
        // hatching, as on a plan: the ground is out of play
        c.strokeStyle = AREA_COL.oobHatch;
        c.lineWidth = Math.max(1, 0.22 * s);
        const gap = 2.2;
        for (let d = -h; d < w + h; d += gap) {
          c.beginPath();
          c.moveTo(tx(x0 + d), tz(z0));
          c.lineTo(tx(x0 + d - h), tz(z1));
          c.stroke();
        }
        break;
      }
    }
    c.restore();
    // the boundary line: a thin white line on the ground, the stakes standing on it
    if (a.kind === "oob" && a.stakes.length > 1) {
      c.save();
      c.strokeStyle = AREA_COL.oobLine;
      c.globalAlpha = 0.85;
      c.lineWidth = Math.max(1.5, 0.12 * s);
      c.setLineDash([0.9 * s, 0.7 * s]);
      c.beginPath();
      a.stakes.forEach(([x, z], i) => (i ? c.lineTo(tx(x), tz(z)) : c.moveTo(tx(x), tz(z))));
      c.stroke();
      c.restore();
    }
  });
}
