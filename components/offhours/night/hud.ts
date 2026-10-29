import { ENGINE_CAL } from "../engineRemote";
import { LIMIT, REDLINE, TOP_GEAR } from "../engineModel";
import { fontFamilies } from "../font";
import { mph, type NightGame } from "./game";
import { pending } from "./score";

// The dash, drawn on the canvas over the road: clean and small, in the site's
// own type. Speed and gear in a ring that is the tachometer (bottom left), the
// clock and the checkpoint strip (top middle), the score (top left), the drift
// readout (bottom right), the gap to the target driver, and the cards: the
// title, the countdown, the end screen. Text is cached by value, so a frame
// that changes nothing builds no strings.

const MINT = "#8ad9a8";
const CREAM = "#f2ead7";
const MUTED = "#a3a69c";
const RED = "#ff5a45";
const AMBER = "#ffc24b";
const INK = "rgba(7,10,9,0.78)";

export type HudOptions = {
  /** the page has touch controls (the keys line is dropped) */
  touch: boolean;
  /** a phone is linked */
  linked: boolean;
  /** lift the bottom of the dash this many px (the touch pads sit there) */
  lift: number;
};

const fontCache = new Map<string, string>();
type Stretchy = CanvasRenderingContext2D & { fontStretch?: string; letterSpacing?: string };
function font(ctx: CanvasRenderingContext2D, kind: "d" | "m", px: number, weight = 700) {
  const key = `${kind}${Math.round(px)}${weight}`;
  let f = fontCache.get(key);
  if (!f) {
    const fam = fontFamilies();
    f = `${weight} ${Math.round(px)}px ${kind === "d" ? fam.display : fam.mono}`;
    fontCache.set(key, f);
  }
  ctx.font = f;
  const c = ctx as Stretchy;
  if ("fontStretch" in c) c.fontStretch = kind === "d" ? "condensed" : "normal";
  if ("letterSpacing" in c) c.letterSpacing = kind === "m" ? `${(px * 0.1).toFixed(1)}px` : "0px";
}

/** strings made from numbers, remade only when the number changes */
const memo: Record<string, { v: number | string; s: string }> = {};
function fmt(key: string, v: number, make: (v: number) => string): string {
  const m = memo[key];
  if (m && m.v === v) return m.s;
  const s = make(v);
  memo[key] = { v, s };
  return s;
}
export const grouped = (n: number) => Math.round(n).toLocaleString("en-US");

const rr = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/** a phone-width canvas: the page's switches take the top right, so the dash rearranges */
export const isNarrow = (w: number) => w < 560;

/** Break `text` into lines no wider than `maxW` at the font now set. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxW) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** the tile's small dash: the name, and the speed */
export function drawAttractHud(ctx: CanvasRenderingContext2D, w: number, h: number, speed: number) {
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  font(ctx, "m", 10, 500);
  ctx.fillStyle = MINT;
  ctx.fillText("NIGHT RUN", 16, 24);
  ctx.fillStyle = MUTED;
  const n = Math.round(mph(speed));
  font(ctx, "d", 34, 800);
  ctx.fillStyle = CREAM;
  ctx.fillText(fmt("att", n, (v) => String(v)), 16, h - 30);
  font(ctx, "m", 9, 500);
  ctx.fillStyle = MUTED;
  ctx.fillText("MPH", 16, h - 14);
  void w;
}

export function drawHud(ctx: CanvasRenderingContext2D, w: number, h: number, g: NightGame, opt: HudOptions, now: number, reduce: boolean) {
  const u = Math.max(0.72, Math.min(1.3, Math.min(w, h * 1.5) / 720));
  const car = g.car;
  ctx.textBaseline = "alphabetic";
  ctx.lineCap = "round";

  if (g.phase === "ready") drawReady(ctx, w, h, u, opt, g);
  if (g.phase === "count" || g.phase === "run") drawDash(ctx, w, h, u, g, now, opt.lift);
  if (g.phase === "count") drawCount(ctx, w, h, u, g, reduce);
  if (g.phase === "run") {
    drawToasts(ctx, w, h, u, g, reduce);
    drawCue(ctx, w, h, u, g, now, reduce);
    if (g.goFlash > 0.4) {
      ctx.globalAlpha = Math.min(1, (g.goFlash - 0.4) * 1.8);
      font(ctx, "d", 120 * u, 800);
      ctx.fillStyle = MINT;
      ctx.textAlign = "center";
      ctx.fillText("GO", w / 2, h * 0.34);
      ctx.globalAlpha = 1;
    }
    if (g.hitFlash > 0.02) {
      ctx.fillStyle = `rgba(255,70,50,${(g.hitFlash * 0.16).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }
  }
  if (g.phase === "done") {
    drawDash(ctx, w, h, u, g, now, opt.lift);
    drawResult(ctx, w, h, u, g, opt);
  }
  void car;
}

function drawDash(ctx: CanvasRenderingContext2D, w: number, h: number, u: number, g: NightGame, now: number, lift: number) {
  const car = g.car;
  const live = g.phase === "run";
  // ---- the ring: speed, gear, revs
  const R = 74 * u;
  const cx = 22 * u + R + 6;
  const cy = h - 18 * u - R - 6 - lift;
  const a0 = Math.PI * 0.72;
  const a1 = Math.PI * 2.28;
  const ang = (rpm: number) => a0 + (Math.min(9000, rpm) / 9000) * (a1 - a0);
  ctx.fillStyle = "rgba(6,9,8,0.55)";
  ctx.beginPath();
  ctx.arc(cx, cy, R + 14 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 6 * u;
  ctx.strokeStyle = "rgba(242,234,215,0.13)";
  ctx.beginPath();
  ctx.arc(cx, cy, R, a0, a1);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,90,69,0.5)";
  ctx.beginPath();
  ctx.arc(cx, cy, R, ang(REDLINE), a1);
  ctx.stroke();
  const rpm = live || g.phase === "count" ? car.rpm : 900;
  ctx.strokeStyle = rpm >= REDLINE ? RED : MINT;
  ctx.beginPath();
  ctx.arc(cx, cy, R, a0, ang(rpm));
  ctx.stroke();
  // ticks every thousand
  ctx.fillStyle = "rgba(242,234,215,0.5)";
  for (let k = 1; k <= 8; k++) {
    const a = ang(k * 1000);
    ctx.fillRect(cx + Math.cos(a) * (R - 11 * u) - 1, cy + Math.sin(a) * (R - 11 * u) - 1, 2, 2);
  }
  // the shift light
  if (car.rpm >= ENGINE_CAL.engine.shiftAt - 100 && !car.auto && live) {
    ctx.fillStyle = Math.floor(now * 14) % 2 ? RED : AMBER;
    ctx.beginPath();
    ctx.arc(cx, cy - R - 10 * u, 5 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  const speed = Math.round(mph(g.speed));
  ctx.textAlign = "center";
  font(ctx, "d", 58 * u, 800);
  ctx.fillStyle = CREAM;
  ctx.fillText(fmt("spd", speed, (v) => String(v)), cx, cy + 14 * u);
  font(ctx, "m", 10 * u, 500);
  ctx.fillStyle = MUTED;
  ctx.fillText("MPH", cx, cy + 32 * u);
  // the gear: D4 in auto, M4 by hand
  font(ctx, "m", 13 * u, 700);
  ctx.fillStyle = car.auto ? MUTED : AMBER;
  const gear = g.phase === "ready" || g.phase === "count" ? "N" : String(Math.min(TOP_GEAR, car.gear) + 1);
  ctx.fillText(car.auto ? `D ${gear}` : `M ${gear}`, cx, cy - 34 * u);

  if (!live && g.phase !== "count") {
    // on the end screen the dash is dimmed by the card, but the ring stays
    return;
  }

  // ---- the clock and the checkpoint strip
  // wide: centred at the top. Narrow (a phone), the mode and gearbox switches own the
  // top right and would sit on a centred clock, so it moves to the left, under the phone hint.
  const narrow = isNarrow(w);
  const top = narrow ? 40 * u : 0;
  const ax = narrow ? 20 * u : w / 2;
  const align: CanvasTextAlign = narrow ? "left" : "center";
  ctx.textAlign = align;
  const t = Math.max(0, g.timeLeft);
  const low = t < 10 && live && g.endWhy === null;
  const flash = low && Math.floor(now * 4) % 2 === 0;
  font(ctx, "m", 10 * u, 500);
  ctx.fillStyle = MUTED;
  ctx.fillText("TIME", ax, top + 22 * u);
  font(ctx, "d", 54 * u, 800);
  ctx.fillStyle = low ? (flash ? RED : AMBER) : CREAM;
  ctx.fillText(fmt("time", Math.round(t * 10), (v) => (v / 10).toFixed(1)), ax, top + 22 * u + 50 * u);
  if (g.cpFlash > 0) {
    const a = Math.min(1, g.cpFlash);
    ctx.fillStyle = `rgba(138,217,168,${(a * 0.9).toFixed(2)})`;
    font(ctx, "m", 11 * u, 700);
  } else {
    ctx.fillStyle = MUTED;
    font(ctx, "m", 10 * u, 500);
  }
  const cpTxt = fmt("cp", g.cp * 100 + g.road.checks.length, () => `CHECKPOINT ${Math.min(g.cp + 1, g.road.checks.length)} / ${g.road.checks.length}`);
  ctx.fillText(cpTxt, ax, top + 22 * u + 70 * u);
  // the strip: the road in eight legs, filled to where the car is
  const sw = narrow ? Math.min(150, w * 0.42) : Math.min(260 * u, w * 0.4);
  const sx = narrow ? ax : w / 2 - sw / 2;
  const sy = top + 22 * u + 80 * u;
  ctx.fillStyle = "rgba(242,234,215,0.16)";
  ctx.fillRect(sx, sy, sw, 3);
  const frac = Math.max(0, Math.min(1, (car.s - 12) / (g.road.finish - 12)));
  ctx.fillStyle = MINT;
  ctx.fillRect(sx, sy, sw * frac, 3);
  for (let k = 1; k <= g.road.checks.length; k++) {
    const x = sx + (sw * (g.road.checks[k - 1] - 12)) / (g.road.finish - 12);
    ctx.fillStyle = k <= g.cp ? MINT : "rgba(242,234,215,0.55)";
    ctx.fillRect(x - 1, sy - 3, 2, 9);
  }
  // the target driver's marker
  const tp = g.scene.ghosts[0].pose.s;
  const tx = sx + (sw * Math.max(0, Math.min(g.road.finish - 12, tp - 12))) / (g.road.finish - 12);
  ctx.strokeStyle = MINT;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(tx, sy + 1.5, 4.5, 0, Math.PI * 2);
  ctx.stroke();

  // ---- the score, top left (under the phone hint; on a phone, under the clock)
  ctx.textAlign = "left";
  const lx = 20 * u;
  const ly = narrow ? sy + 30 * u : 62 * u;
  font(ctx, "m", 10 * u, 500);
  ctx.fillStyle = MUTED;
  ctx.fillText("SCORE", lx, ly);
  font(ctx, "d", 36 * u, 800);
  ctx.fillStyle = CREAM;
  ctx.fillText(fmt("score", g.score, grouped), lx, ly + 34 * u);
  if (g.drift.best > 0) {
    font(ctx, "m", 10 * u, 500);
    ctx.fillStyle = MUTED;
    ctx.fillText(fmt("bestd", g.drift.best, (v) => `BEST DRIFT ${grouped(v)}`), lx, ly + 54 * u);
  }

  // ---- against the target driver, top right (under the mode switch)
  if (g.deltaOn && live && g.endWhy === null) {
    ctx.textAlign = "right";
    const d = g.deltaS;
    const ahead = d <= 0;
    const rx = w - 20 * u;
    // under the page's switches: on a phone those are two rows tall, 88 px down
    const ry = narrow ? 128 : 128 * u;
    font(ctx, "m", 10 * u, 500);
    ctx.fillStyle = MUTED;
    ctx.fillText("VS TARGET", rx, ry - 22 * u);
    font(ctx, "d", 30 * u, 800);
    ctx.fillStyle = ahead ? MINT : AMBER;
    ctx.fillText(fmt("delta", Math.round(d * 10), (v) => `${v <= 0 ? "−" : "+"}${(Math.abs(v) / 10).toFixed(1)}s`), rx, ry + 8 * u);
  }

  // ---- the drift readout, bottom right
  drawDrift(ctx, w, h - lift, u, g);
}

function drawDrift(ctx: CanvasRenderingContext2D, w: number, h: number, u: number, g: NightGame) {
  const d = g.drift;
  const pend = pending(d);
  const rx = w - 22 * u;
  const by = h - 24 * u;
  ctx.textAlign = "right";
  if (pend <= 0 && g.bankFlash <= 0) {
    font(ctx, "m", 10 * u, 500);
    ctx.fillStyle = "rgba(163,166,156,0.7)";
    ctx.fillText("DRIFT", rx, by);
    return;
  }
  const sliding = d.sliding;
  // the panel
  const pw = 210 * u;
  const ph = 92 * u;
  ctx.fillStyle = INK;
  rr(ctx, rx - pw, by - ph + 8 * u, pw, ph, 14 * u);
  ctx.fill();
  ctx.strokeStyle = sliding ? "rgba(138,217,168,0.7)" : "rgba(242,234,215,0.25)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  font(ctx, "m", 10 * u, 500);
  ctx.fillStyle = sliding ? MINT : MUTED;
  ctx.fillText(sliding ? "DRIFTING" : g.bankFlash > 0 && pend <= 0 ? "BANKED" : "STRAIGHTEN TO BANK", rx - 14 * u, by - ph + 28 * u);
  font(ctx, "d", 40 * u, 800);
  ctx.fillStyle = sliding ? CREAM : MINT;
  ctx.fillText(fmt("pend", pend, grouped), rx - 14 * u, by - ph + 68 * u);
  // the multiplier
  if (d.combo > 0) {
    font(ctx, "d", 28 * u, 800);
    ctx.fillStyle = d.combo >= ENGINE_CAL.drift.comboMax ? AMBER : MINT;
    ctx.textAlign = "left";
    ctx.fillText(fmt("combo", d.combo, (v) => `×${v}`), rx - pw + 14 * u, by - ph + 68 * u);
    // time to the next step / time to bank
    const f = sliding ? d.stepT / ENGINE_CAL.drift.comboEveryS : 1 - d.cleanT / ENGINE_CAL.drift.bankStraightS;
    ctx.fillStyle = "rgba(242,234,215,0.16)";
    ctx.fillRect(rx - pw + 14 * u, by + 2 * u, pw - 28 * u, 3);
    ctx.fillStyle = sliding ? MINT : AMBER;
    ctx.fillRect(rx - pw + 14 * u, by + 2 * u, (pw - 28 * u) * Math.max(0, Math.min(1, f)), 3);
  }
}

/** the corner warning: an amber chevron pill that points the way the road turns */
function drawCue(ctx: CanvasRenderingContext2D, w: number, h: number, u: number, g: NightGame, now: number, reduce: boolean) {
  const cue = g.cue;
  if (!cue.on) return;
  const dir = cue.dir;
  // it grows more urgent as the corner closes: the pulse speeds up
  const near = Math.max(0, Math.min(1, 1 - cue.dist / 190));
  const pulse = reduce ? 1 : 0.78 + 0.22 * Math.sin(now * (6 + near * 10));
  const cx = w / 2;
  const cy = h * 0.27 + (isNarrow(w) ? 14 * u : 0);
  font(ctx, "d", 30 * u, 800);
  const label = dir > 0 ? "CORNER RIGHT" : "CORNER LEFT";
  const tw = ctx.measureText(label).width;
  const pw = tw + 96 * u;
  const ph = 56 * u;
  ctx.globalAlpha = pulse;
  ctx.fillStyle = INK;
  rr(ctx, cx - pw / 2, cy - ph / 2, pw, ph, ph / 2);
  ctx.fill();
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = AMBER;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(label, cx, cy + 3 * u);
  font(ctx, "m", 10 * u, 700);
  ctx.fillText("LIFT OR BRAKE", cx, cy + 20 * u);
  // chevrons on the side it turns toward
  ctx.lineWidth = 3.5 * u;
  ctx.lineCap = "round";
  for (let i = 0; i < 2; i++) {
    const x = cx + dir * (pw / 2 - (22 + i * 11) * u);
    ctx.beginPath();
    ctx.moveTo(x - dir * 5 * u, cy - 11 * u);
    ctx.lineTo(x + dir * 5 * u, cy);
    ctx.lineTo(x - dir * 5 * u, cy + 11 * u);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawToasts(ctx: CanvasRenderingContext2D, w: number, h: number, u: number, g: NightGame, reduce: boolean) {
  ctx.textAlign = "center";
  // a corner warning (drawCue) sits just above: give it room
  let y = h * 0.4 + (g.cue.on ? 40 * u : 0);
  for (let i = g.toasts.length - 1; i >= 0; i--) {
    const t = g.toasts[i];
    const inT = ease(t.age / 0.18);
    const out = Math.min(1, (t.life - t.age) / 0.35);
    const a = Math.min(inT, out);
    const k = reduce ? 1 : 0.85 + 0.15 * inT;
    ctx.globalAlpha = a;
    ctx.save();
    ctx.translate(w / 2, y);
    ctx.scale(k, k);
    ctx.fillStyle = t.tone === "bad" ? RED : t.tone === "good" ? MINT : t.tone === "drift" ? CREAM : CREAM;
    font(ctx, "d", 44 * u, 800);
    ctx.fillText(t.text, 0, 0);
    if (t.sub) {
      font(ctx, "m", 13 * u, 700);
      ctx.fillStyle = t.tone === "bad" ? "#ff9a8a" : MINT;
      ctx.fillText(t.sub, 0, 24 * u);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    y += 70 * u;
  }
}

function drawCount(ctx: CanvasRenderingContext2D, w: number, h: number, u: number, g: NightGame, reduce: boolean) {
  const n = g.count;
  if (!n) return;
  const phase = (g.phaseT % 0.9) / 0.9;
  const k = reduce ? 1 : 1.25 - 0.25 * ease(phase * 3);
  ctx.textAlign = "center";
  ctx.save();
  ctx.translate(w / 2, h * 0.36);
  ctx.scale(k, k);
  ctx.globalAlpha = 1 - 0.55 * phase;
  font(ctx, "d", 150 * u, 800);
  ctx.fillStyle = CREAM;
  ctx.fillText(String(n), 0, 40 * u);
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawReady(ctx: CanvasRenderingContext2D, w: number, h: number, u: number, opt: HudOptions, g: NightGame) {
  ctx.fillStyle = "rgba(4,7,6,0.5)";
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = "center";
  const narrow = isNarrow(w);
  const cy = h * 0.27 + (narrow ? 20 : 0);
  font(ctx, "m", 12 * u, 700);
  ctx.fillStyle = MINT;
  ctx.fillText("A CANYON ROAD, AFTER MIDNIGHT", w / 2, cy - 62 * u);
  font(ctx, "d", Math.min(84 * u, w * 0.16), 800);
  ctx.fillStyle = CREAM;
  ctx.fillText("NIGHT RUN", w / 2, cy + 22 * u);
  font(ctx, "m", 13 * u, 700);
  ctx.fillStyle = MINT;
  const go = opt.touch ? "HOLD GAS TO START" : opt.linked ? "HOLD ↑ OR SPACE, OR GAS ON YOUR PHONE" : "HOLD ↑ OR SPACE TO START";
  ctx.fillText(go, w / 2, cy + 62 * u);
  const text = opt.touch
    ? ["STEER WITH THE ARROWS. LIFT OR BRAKE INTO A CORNER TO KICK THE TAIL OUT.", `${g.road.checks.length} CHECKPOINTS. BEAT THE TARGET.`]
    : ["← → STEER · ↓ BRAKE · SHIFT HANDBRAKE · T GEARBOX", "LIFT OR BRAKE INTO A CORNER AND THE TAIL STEPS OUT: HOLD IT WITH COUNTER-STEER AND GAS", `${g.road.checks.length} CHECKPOINTS · BEAT THE TARGET`];
  // the how-to sits on a dark card: the road's white lines run right through it otherwise
  font(ctx, "m", 11 * u, 500);
  const maxW = w - 56;
  const lines = text.flatMap((t) => wrap(ctx, t, maxW));
  const lh = 20 * u;
  const widest = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)));
  const y0 = cy + 94 * u;
  ctx.fillStyle = "rgba(6,9,8,0.72)";
  rr(ctx, w / 2 - widest / 2 - 16, y0 - 18 * u, widest + 32, lines.length * lh + 14 * u, 12 * u);
  ctx.fill();
  ctx.fillStyle = "#c4c7bc";
  lines.forEach((l, i) => ctx.fillText(l, w / 2, y0 + i * lh));
}

/** how tall the end card is, in the dash's own units, and where its bottom edge is on the canvas (the button goes under it) */
const RESULT_H = 404;
export function resultBottom(w: number, h: number, opt: { touch: boolean }) {
  void opt;
  const u = Math.max(0.72, Math.min(1.3, Math.min(w, h * 1.5) / 720));
  const ph = RESULT_H * u;
  const y = Math.max(16, h * 0.5 - ph / 2 - 10 * u);
  return y + ph;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

function drawResult(ctx: CanvasRenderingContext2D, w: number, h: number, u: number, g: NightGame, opt: HudOptions) {
  const r = g.result;
  if (!r) return;
  ctx.fillStyle = "rgba(4,7,6,0.62)";
  ctx.fillRect(0, 0, w, h);
  const pw = Math.min(460 * u, w - 32);
  const ph = RESULT_H * u;
  const x = w / 2 - pw / 2;
  const y = Math.max(16, h * 0.5 - ph / 2 - 10 * u);
  ctx.fillStyle = "rgba(10,13,12,0.9)";
  rr(ctx, x, y, pw, ph, 18 * u);
  ctx.fill();
  ctx.strokeStyle = "rgba(138,217,168,0.55)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.textAlign = "left";
  font(ctx, "m", 11 * u, 700);
  ctx.fillStyle = r.finished ? MINT : AMBER;
  ctx.fillText(r.finished ? "CANYON CLEARED" : "OUT OF TIME", x + 28 * u, y + 38 * u);
  font(ctx, "d", 64 * u, 800);
  ctx.fillStyle = CREAM;
  ctx.fillText(grouped(r.score), x + 28 * u, y + 100 * u);
  font(ctx, "m", 10 * u, 500);
  ctx.fillStyle = MUTED;
  ctx.fillText("TOTAL SCORE", x + 28 * u, y + 120 * u);
  const vs = r.vsTargetS;
  const rows: [string, string][] = [
    r.finished ? ["FINISH TIME", clock(r.time)] : ["DISTANCE", `${r.miles.toFixed(2)} mi`],
    vs !== null ? ["VS TARGET", `${vs <= 0 ? "−" : "+"}${Math.abs(vs).toFixed(1)}s`] : ["CHECKPOINTS", `${r.checkpoints} / ${g.road.checks.length}`],
    ["BEST DRIFT", grouped(r.bestDrift)],
    ["DRIFT BANKED", grouped(r.driftTotal)],
    ["BEST THIS VISIT", grouped(r.bestScore)],
  ];
  rows.forEach(([k, v], i) => {
    const ry = y + 160 * u + i * 31 * u;
    font(ctx, "m", 11 * u, 500);
    ctx.fillStyle = MUTED;
    ctx.textAlign = "left";
    ctx.fillText(k, x + 28 * u, ry);
    font(ctx, "d", 24 * u, 800);
    ctx.fillStyle = k === "VS TARGET" ? (vs !== null && vs <= 0 ? MINT : AMBER) : CREAM;
    ctx.textAlign = "right";
    ctx.fillText(v, x + pw - 28 * u, ry + 3 * u);
  });
  ctx.textAlign = "left";
  font(ctx, "m", 11 * u, 700);
  // two honest lines at most: a new best score (there was one before it to beat), and the ghost
  const lineY = y + ph - 60 * u;
  let n = 0;
  if (r.prevBestScore > 0 && r.score > r.prevBestScore) {
    ctx.fillStyle = MINT;
    ctx.fillText(`● NEW BEST SCORE, UP FROM ${grouped(r.prevBestScore)}`, x + 28 * u, lineY - n * 20 * u);
    n++;
  }
  if (r.newBest) {
    ctx.fillStyle = MINT;
    ctx.fillText("● NEW BEST RUN: IT RACES YOU NEXT TIME", x + 28 * u, lineY - n * 20 * u);
  }
  ctx.fillStyle = CREAM;
  ctx.fillText(opt.touch ? "TAP TO DRIVE AGAIN" : "ENTER OR SPACE TO DRIVE AGAIN", x + 28 * u, y + ph - 26 * u);
  void LIMIT;
}
