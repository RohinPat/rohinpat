import { fontFamilies } from "../font";

// Learn's dash: all caps, on the canvas, in the same type as the Night run's.
// Top left: the generation and the best so far, a line under it, and a small
// chart of the best (and the mean) of every generation. The single line that
// opens the visit is drawn big over the road and goes after a few generations.

const MINT = "#8ad9a8";
const CREAM = "#f2ead7";
const MUTED = "#a3a69c";
const AMBER = "#ffc24b";
const INK = "rgba(7,10,9,0.78)";

export type LearnHud = {
  gen: number;
  best: string;
  /** what is happening, in caps */
  sub: string;
  /** the chart: one value per generation (0..1), the best and the mean, and how many to draw */
  bestSeries: number[];
  meanSeries: number[];
  n: number;
  /** the opening line is up while this is above zero (0..1: it fades) */
  intro: number;
};

type Stretchy = CanvasRenderingContext2D & { fontStretch?: string; letterSpacing?: string };
function font(ctx: CanvasRenderingContext2D, kind: "d" | "m", px: number, weight = 700) {
  const fam = fontFamilies();
  ctx.font = `${weight} ${Math.round(px)}px ${kind === "d" ? fam.display : fam.mono}`;
  const c = ctx as Stretchy;
  if ("fontStretch" in c) c.fontStretch = kind === "d" ? "condensed" : "normal";
  if ("letterSpacing" in c) c.letterSpacing = kind === "m" ? `${(px * 0.1).toFixed(1)}px` : "0px";
}

export const INTRO = "24 CARS, NO DRIVING LESSONS. WATCH THEM LEARN.";

export function drawLearnHud(ctx: CanvasRenderingContext2D, w: number, h: number, hud: LearnHud) {
  const narrow = w < 560;
  // on a phone the mode switch takes the whole top right: the dash starts below it
  const y0 = narrow ? 52 : 0;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;
  font(ctx, "m", 10, 500);
  ctx.fillStyle = MINT;
  ctx.fillText("LEARN", 16, 24 + y0);
  font(ctx, "d", narrow ? 24 : 32, 800);
  ctx.fillStyle = CREAM;
  const main = `GEN ${hud.gen.toLocaleString("en-US")} · ${hud.best}`;
  ctx.fillText(main, 16, (narrow ? 52 : 58) + y0);
  font(ctx, "m", 10, 500);
  ctx.fillStyle = MUTED;
  ctx.fillText(hud.sub, 16, (narrow ? 70 : 78) + y0);
  drawChart(ctx, 16, (narrow ? 82 : 90) + y0, narrow ? 140 : 180, narrow ? 40 : 52, hud);
  if (hud.intro > 0) {
    const size = narrow ? 24 : 40;
    font(ctx, "d", size, 800);
    ctx.textAlign = "center";
    const tw = ctx.measureText(INTRO).width;
    const lines = tw > w - 32 ? 2 : 1;
    const text = lines === 1 ? [INTRO] : [INTRO.slice(0, INTRO.indexOf(".") + 1), INTRO.slice(INTRO.indexOf(".") + 2)];
    const y = h * 0.34;
    ctx.globalAlpha = hud.intro;
    ctx.fillStyle = INK;
    const bw = Math.min(w - 24, Math.max(...text.map((t) => ctx.measureText(t).width)) + 36);
    ctx.fillRect(w / 2 - bw / 2, y - size - 6, bw, size * lines * 1.25 + 22);
    ctx.fillStyle = CREAM;
    text.forEach((t, i) => ctx.fillText(t, w / 2, y + i * size * 1.2));
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  }
}

/** the best (solid) and the mean (faint) of each generation, 0..1 */
function drawChart(ctx: CanvasRenderingContext2D, x: number, y: number, cw: number, ch: number, hud: LearnHud) {
  ctx.fillStyle = INK;
  ctx.fillRect(x - 6, y - 6, cw + 12, ch + 26);
  ctx.strokeStyle = "rgba(242,234,215,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  // the line a finish lifts the best onto
  const fy = y + ch - 0.7 * ch;
  ctx.moveTo(x, fy);
  ctx.lineTo(x + cw, fy);
  ctx.stroke();
  const n = hud.n;
  if (n >= 2) {
    const line = (v: number[], color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const px = x + (cw * i) / (n - 1);
        const py = y + ch - v[i] * ch;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    };
    line(hud.meanSeries, "rgba(242,234,215,0.35)", 1);
    line(hud.bestSeries, AMBER, 1.6);
    ctx.fillStyle = AMBER;
    ctx.beginPath();
    ctx.arc(x + cw, y + ch - hud.bestSeries[n - 1] * ch, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  font(ctx, "m", 9, 500);
  ctx.fillStyle = MUTED;
  ctx.fillText("BEST PER GEN", x, y + ch + 14);
}
