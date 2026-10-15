"use client";

import { useCanvas } from "./useCanvas";

// Blaugrana stripes hanging like cloth. Each stripe edge is displaced by a
// travelling wave; the pointer pushes the fabric away like a hand through
// a flag. Folds are shaded from the slope of the displacement.

const GARNET = [165, 0, 68];
const BLUE = [0, 77, 152];
const STRIPES = 9;
const BAND = 6;

export default function Blaugrana() {
  const ref = useCanvas(({ ctx, w, h, t, p }) => {
    const sw = w / STRIPES;
    const amp = sw * 0.22;

    const disp = (x: number, y: number) => {
      let d = Math.sin(y * 0.018 + t * 1.6 + x * 0.004) * amp + Math.sin(y * 0.041 - t * 1.1) * amp * 0.35;
      if (p.inside) {
        const dx = x - p.x;
        const dy = y - p.y;
        const k = Math.exp(-(dx * dx + dy * dy) / (2 * 60 * 60));
        d += Math.sign(dx || 1) * k * sw * 0.55;
      }
      return d;
    };

    for (let y = 0; y < h; y += BAND) {
      const yc = y + BAND / 2;
      for (let i = -1; i <= STRIPES; i++) {
        const xl = i * sw;
        const xr = xl + sw;
        const l = xl + disp(xl, yc);
        const r = xr + disp(xr, yc);
        // fold shading from how the edge leans
        const slope = (disp(xl + sw / 2, yc + BAND) - disp(xl + sw / 2, yc - BAND)) / (2 * BAND);
        const shade = Math.max(-0.35, Math.min(0.35, slope * 1.4));
        const base = ((i % 2) + 2) % 2 === 0 ? GARNET : BLUE;
        const c = base.map((v) => Math.round(shade > 0 ? v + (255 - v) * shade * 0.5 : v * (1 + shade)));
        ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        ctx.fillRect(l, y, r - l + 0.6, BAND + 0.6);
      }
    }

    // a thin gold thread down one seam, like a shirt trim
    ctx.strokeStyle = "rgba(237,187,0,0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const seam = Math.floor(STRIPES / 2) * sw;
    for (let y = 0; y <= h; y += BAND) {
      const x = seam + disp(seam, y);
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });

  return <canvas ref={ref} aria-hidden="true" className="absolute inset-0 w-full h-full touch-pan-y" />;
}
