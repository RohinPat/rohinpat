import type { BuiltHole } from "@/components/offhours/golf/course";
import type { Putt } from "@/components/offhours/golf/green";
import { reliefOf } from "./relief";
import { puttF } from "./puttcam";
import type { View } from "./flyover";

// The hold-to-read view on the green: a map of the green from above, or a low look along the line from behind the
// ball. Held with Tab (desktop) or a press on the Map / Low chips (touch); 1 and 2 switch while it is held, and a 1 or 2
// at address latches it until the same key is pressed again. Nothing here is stored: the last choice lasts the session.

export type ReadKind = "map" | "low";

/** the screen's share of the height, from the top, of the ball and of the cup in the map view (the projection centre is 40%) */
const MAP_BALL = 0.78, MAP_CUP = 0.2;
/** how fast the camera and the overlay move between the putt's view and this one: most of the way in 0.3 s */
const RATE = 10;
const UP: Vec = { x: 0, y: 1, z: 0 };

type Vec = { x: number; y: number; z: number };

/** the view a read can start from: the putt is at address on the green, nothing moving, no swing or pull under way */
export function canRead(p: Putt, phase: string) {
  return phase === "putt" && !p.ball.moving && !p.ball.sunk && !p.putter && !p.tap && !p.done && !p.reading && !p.aiming && !p.kCharging;
}

/**
 * What the keys and the chips ask for. `kind()` is the view on screen, or null: it is on while Tab is held or a chip is
 * pressed, and after a 1 or 2 at address until that key is pressed again.
 */
export class ReadInput {
  private pref: ReadKind = "map";
  private held = false;
  private latched = false;
  kind(): ReadKind | null {
    return this.held || this.latched ? this.pref : null;
  }
  /** how it is up: held (Tab or a chip), latched (1 or 2), or not at all */
  how(): "held" | "latched" | null {
    return this.held ? "held" : this.latched ? "latched" : null;
  }
  /** Tab: held opens the view; a press while latched closes it (Tab is never a way out of the page) */
  tab(down: boolean) {
    if (!down) this.held = false;
    else if (this.latched) this.latched = false;
    else this.held = true;
  }
  /** a chip pressed or let go on touch: the same as holding Tab with that view picked */
  hold(k: ReadKind, down: boolean) {
    if (down) {
      this.pref = k;
      this.held = true;
    } else this.held = false;
  }
  /** 1 or 2: switches the view while it is held; at address with nothing held it latches the view, or lets it go */
  digit(k: ReadKind) {
    const was = this.latched && this.pref === k;
    this.pref = k;
    if (!this.held) this.latched = !was;
  }
  /** the putt is not at address, or the page is paused: nothing is held or latched */
  reset() {
    this.held = false;
    this.latched = false;
  }
}

const cross = (a: Vec, b: Vec): Vec => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: Vec): Vec => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/**
 * The camera for a read, in the course's frame. Map: straight down over the green, north (the cup) up the screen, the
 * ball low and the cup high in the frame with a margin. Low: 1 m behind the ball and 0.2 m above the green there, looking
 * along the line to the cup. `w` and `h` are the screen's size: the focal length depends on it.
 */
export function readPose(hole: BuiltHole, ball: [number, number], kind: ReadKind, w: number, h: number): View {
  const rel = reliefOf(hole);
  const F = puttF(w, h);
  const cup = hole.green.cup;
  const [bx, by] = ball, [cx, cy] = cup;
  // the green's own direction from the ball to the cup, and the same in the course's frame (x right, z downrange)
  const dl = Math.hypot(cx - bx, cy - by) || 1;
  const gux = dl > 1e-6 ? (cx - bx) / dl : 0, guy = dl > 1e-6 ? (cy - by) / dl : 1;
  const [b0x, b0z] = hole.fromGreen(bx, by), [c0x, c0z] = hole.fromGreen(cx, cy);
  const cdx = c0x - b0x, cdz = c0z - b0z, cdl = Math.hypot(cdx, cdz) || 1;
  if (kind === "map") {
    // the ball and cup are MAP_BALL and MAP_CUP of the way down the frame: a span of 0.58 of the height is L metres,
    // so the camera stands L * F / (span * h) above the green (at least 1.6 m, and a 4 m line at least)
    const span = MAP_BALL - MAP_CUP;
    const L = Math.max(dl, 4);
    const H = Math.max(1.6, (L * F) / (span * h));
    // the middle of the ball and cup sits at the middle of their rows; the optical axis (the 40% row) is that much
    // further toward the cup
    const mx = (bx + cx) / 2, my = (by + cy) / 2;
    const s = ((MAP_BALL + MAP_CUP) / 2 - 0.4) * h * (H / F);
    const ax = mx + gux * s, ay = my + guy * s;
    const [x, z] = hole.fromGreen(ax, ay);
    const y = rel.yG(ax, ay);
    const up = norm({ x: cdx / cdl, y: 0, z: cdz / cdl });
    return { x, y: y + H, z, tx: x, ty: y, tz: z, F, up };
  }
  // the low view: a metre back along the line, 0.2 m above the green there, looking at the cup
  const bxBack = bx - gux, byBack = by - guy;
  const [px, pz] = hole.fromGreen(bxBack, byBack);
  return { x: px, y: rel.yG(bxBack, byBack) + 0.2, z: pz, tx: c0x, ty: rel.yG(cx, cy) + 0.02, tz: c0z, F };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** a view part of the way from a to b; the up vectors are turned the same way (a view with none is up) */
function lerpView(a: View, b: View, k: number): View {
  const ua = a.up ?? UP, ub = b.up ?? UP;
  return {
    x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k), tx: lerp(a.tx, b.tx, k), ty: lerp(a.ty, b.ty, k), tz: lerp(a.tz, b.tz, k), F: lerp(a.F, b.F, k),
    up: norm({ x: lerp(ua.x, ub.x, k), y: lerp(ua.y, ub.y, k), z: lerp(ua.z, ub.z, k) }),
  };
}

/**
 * The read's camera from one frame to the next: it eases from the putt camera into the view and back, glides between the
 * two views, and hands the putt camera back (null) once it is all the way back. `look.k` is how far in it is, for the
 * overlay's fade.
 */
export class ReadCam {
  private amt = 0;
  private kind: ReadKind = "map";
  private pose: View | null = null;
  step(kind: ReadKind | null, pose: View | null, put: View, dt: number, reduce: boolean): View | null {
    const k = reduce ? 1 : 1 - Math.exp(-dt * RATE);
    if (kind && pose) {
      this.kind = kind;
      this.pose = this.pose && !reduce ? lerpView(this.pose, pose, k) : { ...pose };
    }
    this.amt += ((kind ? 1 : 0) - this.amt) * k;
    if (this.amt < 0.002) {
      this.amt = 0;
      if (!kind) this.pose = null;
      return null;
    }
    if (!this.pose) return null;
    // the view's up turns from the putt's (up) to north up the screen in step with the camera
    const v = lerpView(put, this.pose, smooth(this.amt));
    v.look = { kind: this.kind, k: this.amt };
    return v;
  }
  reset() {
    this.amt = 0;
    this.pose = null;
  }
}
