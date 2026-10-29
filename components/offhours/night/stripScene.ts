import { seeded } from "../useCanvas";

// The drag strip's place. The strip was a dial over a carbon weave and two lanes;
// this gives it somewhere to be: a floodlit quarter mile at night, seen from
// above and a little beside. Behind the lanes a low wall with its kerb, a
// grandstand with a crowd, the lights of a town on a ridge, floodlight towers
// at the edges with their light falling across the asphalt; on the lanes rubber
// from the launch, light pools and the lines. All of it is painted once per size
// (DragStrip.tsx blits it), in the same ink, cream, green and mint as the rest
// of the site and the night road. The start tree, the cars, the smoke and the
// readouts are drawn live on top.

export type Geom = {
  lanes: number;
  roadH: number;
  /** the lanes' top edge */
  ry: number;
  laneH: number;
  carLen: number;
  /** the start line and the finish line, px */
  x0: number;
  x1: number;
  /** the wall above the lanes: its top edge and its height */
  wallY: number;
  wallH: number;
};

/** where the lanes, the line and the wall sit for a canvas: the one place both the picture and the live drawing read it from */
export function stripGeom(w: number, h: number, play: boolean): Geom {
  const lanes = play ? 2 : 1;
  const roadH = play ? Math.max(76, Math.min(150, h * 0.26)) : Math.max(40, h * 0.18);
  const ry = h - roadH;
  const laneH = roadH / lanes;
  const carLen = Math.max(30, Math.min(88, laneH * 1.25));
  const x0 = carLen + 14;
  const x1 = play ? w - 22 : w - 132;
  const wallH = Math.max(7, Math.min(20, h * 0.035));
  return { lanes, roadH, ry, laneH, carLen, x0, x1, wallY: ry - wallH, wallH };
}

const glowAt = (x: CanvasRenderingContext2D, cx: number, cy: number, r: number, rgb: string, a: number) => {
  const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  x.fillStyle = g;
  x.fillRect(cx - r, cy - r, r * 2, r * 2);
};

/** A floodlight tower: a thin mast, a bank of lamps, a halo, and a wedge of light thrown down at the wall. */
function tower(x: CanvasRenderingContext2D, px: number, base: number, top: number, throwTo: number, lean: number) {
  x.strokeStyle = "#16201d";
  x.lineWidth = 2.2;
  x.beginPath();
  x.moveTo(px, base);
  x.lineTo(px, top);
  x.stroke();
  x.fillStyle = "#101916";
  x.fillRect(px - 11, top - 5, 22, 7);
  x.globalCompositeOperation = "lighter";
  glowAt(x, px, top - 1, 46, "255,240,200", 0.55);
  x.fillStyle = "rgba(255,246,222,0.95)";
  for (let i = 0; i < 4; i++) x.fillRect(px - 9 + i * 5.4, top - 3, 3.4, 3);
  // the light on the wall and the lane
  const g = x.createLinearGradient(px, top, px + lean, throwTo);
  g.addColorStop(0, "rgba(255,240,200,0.09)");
  g.addColorStop(1, "rgba(255,240,200,0)");
  x.fillStyle = g;
  x.beginPath();
  x.moveTo(px - 8, top);
  x.lineTo(px + 8, top);
  x.lineTo(px + lean + 120, throwTo);
  x.lineTo(px + lean - 120, throwTo);
  x.closePath();
  x.fill();
  x.globalCompositeOperation = "source-over";
}

/** The picture behind everything: sky to asphalt. `x` is a canvas of w by h CSS px (already scaled for the device). */
export function paintStrip(x: CanvasRenderingContext2D, w: number, h: number, play: boolean) {
  const g = stripGeom(w, h, play);
  const { ry, roadH, laneH, lanes, x0, x1, wallY, wallH, carLen } = g;
  const rng = seeded(7001);
  const sc = Math.max(0.6, Math.min(1.5, h / 700));

  // ---- the sky and what is on its edge
  const sky = x.createLinearGradient(0, 0, 0, wallY);
  sky.addColorStop(0, "#020504");
  sky.addColorStop(0.5, "#06110e");
  sky.addColorStop(0.86, "#0d241c");
  sky.addColorStop(1, "#163a2f");
  x.fillStyle = sky;
  x.fillRect(0, 0, w, wallY + 1);
  const nStars = Math.round((w * wallY) / 3000);
  for (let i = 0; i < nStars; i++) {
    const a = 0.2 + 0.6 * Math.pow(rng(), 2);
    x.fillStyle = `rgba(235,246,240,${a.toFixed(2)})`;
    const sz = rng() > 0.93 ? 1.8 : 1.1;
    x.fillRect(rng() * w, Math.pow(rng(), 1.5) * wallY * 0.8, sz, sz);
  }
  // the glow of a town beyond the stands: a warm band on the horizon
  const gh = Math.max(24, Math.min(92, (wallY - 0) * 0.14 * sc * 1.3));
  const horizon = wallY - gh * 0.55;
  x.globalCompositeOperation = "lighter";
  const hz = x.createLinearGradient(0, horizon - wallY * 0.22, 0, horizon + 4);
  hz.addColorStop(0, "rgba(138,217,168,0)");
  hz.addColorStop(0.75, "rgba(138,217,168,0.08)");
  hz.addColorStop(1, "rgba(255,170,110,0.12)");
  x.fillStyle = hz;
  x.fillRect(0, horizon - wallY * 0.22, w, wallY * 0.22 + 4);
  x.globalCompositeOperation = "source-over";
  // a ridge, two of them: pointed, the far one lighter, with the lights of a town at their foot
  const ridge = (base: number, amp: number, col: string, rim: string, seed: number) => {
    const r2 = seeded(seed);
    const ph = [r2() * 6.28, r2() * 6.28, r2() * 6.28, r2() * 6.28];
    x.fillStyle = col;
    x.beginPath();
    x.moveTo(0, base + 2);
    const pts: number[] = [];
    for (let px = 0; px <= w; px += 3) {
      const u = px / w;
      const s1 = 0.5 + 0.5 * Math.sin(u * 5.1 + ph[0]);
      const s2 = 1 - Math.abs(Math.sin(u * 11.7 + ph[1]));
      const s3 = 1 - Math.abs(Math.sin(u * 27 + ph[2]));
      const hgt = amp * (0.5 * s1 + 0.35 * s2 + 0.15 * s3);
      pts.push(base - hgt);
      x.lineTo(px, base - hgt);
    }
    x.lineTo(w, base + 2);
    x.closePath();
    x.fill();
    x.strokeStyle = rim;
    x.lineWidth = 1.2;
    x.beginPath();
    pts.forEach((y, i) => (i ? x.lineTo(i * 3, y + 0.6) : x.moveTo(0, y + 0.6)));
    x.stroke();
  };
  ridge(horizon + 6, wallY * 0.2, "#0f2420", "rgba(170,226,196,0.22)", 11);
  // the town: dots in warm colours along a band at the foot of the far ridge
  x.globalCompositeOperation = "lighter";
  const nTown = Math.round(w / 3.2);
  for (let i = 0; i < nTown; i++) {
    const px = rng() * w;
    const py = horizon - 2 + rng() * gh * 0.42;
    const tone = rng();
    x.fillStyle = tone < 0.6 ? "rgba(255,206,140,0.7)" : tone < 0.85 ? "rgba(255,170,100,0.6)" : "rgba(196,226,255,0.6)";
    x.fillRect(px, py, rng() > 0.9 ? 2 : 1.3, 1.3);
  }
  x.globalCompositeOperation = "source-over";
  ridge(horizon + gh * 0.5, wallY * 0.12, "#08130f", "rgba(170,226,196,0.1)", 23);

  // ---- floodlight towers at the edges (and a pair nearer in on a wide screen)
  const towers = w > 700 ? [0.035, 0.2, 0.8, 0.965] : [0.04, 0.96];
  const th = Math.min(wallY * 0.7, 300 * sc);
  for (const t of towers) tower(x, w * t, wallY, Math.max(14, wallY - th * (t > 0.1 && t < 0.9 ? 0.7 : 1)), wallY + roadH * 0.5, (0.5 - t) * w * 0.25);

  // ---- the grandstand, on the right behind the lanes: stepped rows, a crowd, a roof lit underneath, and a timing tower at the finish end
  const sx0 = play ? Math.max(x0 + w * 0.34, w * 0.4) : Math.max(x0 + w * 0.3, w * 0.34);
  const sx1 = Math.min(w - 8, x1 + 6);
  const rows = 5;
  const sh = Math.min(gh * 1.7, wallY * 0.3);
  // (a narrow screen has its readouts along the wall: no stand there)
  if (sx1 - sx0 > 60 && w >= 560) {
    for (let r = 0; r < rows; r++) {
      const y1 = wallY - (sh * r) / rows;
      const y0 = wallY - (sh * (r + 1)) / rows;
      x.fillStyle = r % 2 ? "#0c1613" : "#101b17";
      x.fillRect(sx0 + r * 4, y0, sx1 - sx0 - r * 8 - 54 * sc, y1 - y0 + 0.5);
      const n = Math.round((sx1 - sx0) / 9);
      for (let i = 0; i < n; i++) {
        if (rng() < 0.2) continue;
        const px = sx0 + 4 + r * 4 + rng() * (sx1 - sx0 - r * 8 - 62 * sc);
        const tone = rng();
        x.fillStyle = tone < 0.1 ? "rgba(242,234,215,0.42)" : tone < 0.2 ? "rgba(138,217,168,0.36)" : tone < 0.32 ? "rgba(255,200,130,0.3)" : "rgba(44,60,57,0.9)";
        const ph = Math.max(3, (y1 - y0) * 0.5);
        x.fillRect(px, y1 - ph - (y1 - y0) * 0.1, 2.6, ph);
        x.fillRect(px - 0.4, y1 - ph - (y1 - y0) * 0.1 - 1.6, 3.4, 2);
      }
    }
    // the roof on posts, its underside lit
    x.fillStyle = "#08100e";
    x.fillRect(sx0 - 4, wallY - sh - gh * 0.3, sx1 - sx0 - 48 * sc, gh * 0.12);
    x.fillStyle = "#16221e";
    for (let px = sx0; px < sx1 - 56 * sc; px += 46) x.fillRect(px, wallY - sh - gh * 0.18, 2, gh * 0.18 + 2);
    x.globalCompositeOperation = "lighter";
    const under = x.createLinearGradient(0, wallY - sh - gh * 0.2, 0, wallY - sh + gh * 0.2);
    under.addColorStop(0, "rgba(255,236,190,0.4)");
    under.addColorStop(1, "rgba(255,236,190,0)");
    x.fillStyle = under;
    x.fillRect(sx0, wallY - sh - gh * 0.18, sx1 - sx0 - 52 * sc, gh * 0.4);
    x.fillStyle = "rgba(242,234,215,0.8)";
    x.fillRect(sx0 - 4, wallY - sh - gh * 0.3, sx1 - sx0 - 48 * sc, 1.3);
    x.globalCompositeOperation = "source-over";
    // the timing tower: a box with a few lit rows, beside the finish
    const tx = sx1 - 46 * sc;
    const tw = 38 * sc;
    const tHt = sh + gh * 0.5;
    x.fillStyle = "#0b1512";
    x.fillRect(tx, wallY - tHt, tw, tHt);
    x.strokeStyle = "rgba(242,234,215,0.25)";
    x.lineWidth = 1;
    x.strokeRect(tx + 0.5, wallY - tHt + 0.5, tw - 1, tHt - 1);
    x.globalCompositeOperation = "lighter";
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        if (rng() < 0.18) continue;
        x.fillStyle = rng() < 0.2 ? "rgba(196,226,255,0.8)" : "rgba(255,214,150,0.85)";
        x.fillRect(tx + 4 * sc + c * 11 * sc, wallY - tHt + 6 * sc + r * (tHt / 4.4), 7 * sc, 4 * sc);
      }
    }
    x.globalCompositeOperation = "source-over";
  }

  // ---- the wall in front of the stands: a dark face, a pale top edge, a kerb of mint and ink blocks, reflectors
  x.fillStyle = "#0b1210";
  x.fillRect(0, wallY, w, wallH + 1);
  x.fillStyle = "rgba(242,234,215,0.55)";
  x.fillRect(0, wallY, w, 1.5);
  const blk = Math.max(10, wallH * 1.4);
  for (let px = 0; px < w; px += blk * 2) {
    x.fillStyle = "rgba(138,217,168,0.2)";
    x.fillRect(px, wallY + wallH * 0.5, blk, wallH * 0.4);
  }
  x.globalCompositeOperation = "lighter";
  for (let px = blk; px < w; px += blk * 4) {
    x.fillStyle = "rgba(255,176,66,0.7)";
    x.fillRect(px, wallY + 2, 2, 2);
  }
  x.globalCompositeOperation = "source-over";

  // ---- the asphalt: a dark surface with grain, rubber laid at the launch, the edge lines
  x.fillStyle = "#131715";
  x.fillRect(0, ry, w, roadH);
  x.fillStyle = "rgba(255,255,255,0.03)";
  const nGrain = Math.round((w * roadH) / 90);
  for (let i = 0; i < nGrain; i++) x.fillRect(rng() * w, ry + rng() * roadH, 1.2, 1.2);
  x.fillStyle = "rgba(0,0,0,0.25)";
  for (let i = 0; i < nGrain / 2; i++) x.fillRect(rng() * w, ry + rng() * roadH, 1.6, 1.1);
  // the launch pad: a slightly paler, sealed strip either side of the line, and the burnt rubber in each lane
  x.fillStyle = "rgba(242,234,215,0.045)";
  x.fillRect(x0 - carLen - 24, ry, carLen + 24 + 70, roadH);
  for (let l = 0; l < lanes; l++) {
    const yc = ry + laneH * (l + 0.5);
    for (let k = 0; k < 9; k++) {
      const len = 40 + rng() * 120;
      const px = x0 - carLen - 10 + rng() * 40;
      const py = yc + (rng() - 0.5) * laneH * 0.55;
      const gr = x.createLinearGradient(px, 0, px + len, 0);
      gr.addColorStop(0, "rgba(0,0,0,0.5)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = gr;
      x.fillRect(px, py, len, 2 + rng() * 2.4);
    }
  }
  // light pools from the towers, laid along the lanes
  x.globalCompositeOperation = "lighter";
  const pools = w > 700 ? 6 : 3;
  for (let i = 0; i < pools; i++) {
    const px = ((i + 0.5) / pools) * w;
    const ph = roadH * 0.5;
    x.save();
    x.translate(px, ry + roadH * 0.45);
    x.scale(1, roadH / (w / pools) * 0.9);
    const g2 = x.createRadialGradient(0, 0, 0, 0, 0, w / pools / 1.4);
    g2.addColorStop(0, "rgba(255,240,205,0.07)");
    g2.addColorStop(1, "rgba(255,240,205,0)");
    x.fillStyle = g2;
    x.fillRect(-w / pools, -w / pools, (w / pools) * 2, (w / pools) * 2);
    x.restore();
    void ph;
  }
  x.globalCompositeOperation = "source-over";
  // the edge lines
  x.fillStyle = "rgba(242,234,215,0.5)";
  x.fillRect(0, ry + 1, w, 1.5);
  x.fillRect(0, h - 2.5, w, 1.5);
}
