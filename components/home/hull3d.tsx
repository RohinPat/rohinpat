import { memo, type CSSProperties } from "react";

// Solid bodies for the home device, in CSS 3D. The screen stays the real DOM;
// this file only draws what's *around* it: side walls, buttons, a back panel.
//
// A body is a ring of thin flat "wall" quads standing between the front plane
// and the back plane. Each quad is a rectangle (chord length x thickness) set
// on the outline of the rounded rectangle, so the corners are polygons of a few
// facets rather than a stack of plates: unlike plates, walls have no gaps even
// edge-on, which the Duo's swinging cover needs (it passes through 90 degrees).
// Every wall is shaded once, statically, from its outward normal (a key light
// from the upper left), so each side of the titanium catches light differently.
//
// Sizes come from CSS custom properties (--w, --h, --r on the container), so
// one set of quads serves every breakpoint: positions are calc() of those.

// ---------- a length that is (c px + w*--w + h*--h + r*--r) ----------

type L = { c: number; w: number; h: number; r: number };
const L0: L = { c: 0, w: 0, h: 0, r: 0 };
const px = (c: number): L => ({ ...L0, c });
const W: L = { ...L0, w: 1 };
const H: L = { ...L0, h: 1 };
const R: L = { ...L0, r: 1 };
const add = (a: L, b: L): L => ({ c: a.c + b.c, w: a.w + b.w, h: a.h + b.h, r: a.r + b.r });
const sub = (a: L, b: L): L => add(a, scale(b, -1));
const scale = (a: L, k: number): L => ({ c: a.c * k, w: a.w * k, h: a.h * k, r: a.r * k });
const n3 = (n: number) => String(Math.round(n * 1000) / 1000);
const css = (a: L): string => {
  const t: string[] = [];
  if (a.c || (!a.w && !a.h && !a.r)) t.push(`${n3(a.c)}px`);
  if (a.w) t.push(`${n3(a.w)} * var(--w)`);
  if (a.h) t.push(`${n3(a.h)} * var(--h)`);
  if (a.r) t.push(`${n3(a.r)} * var(--r)`);
  return t.length === 1 && !a.w && !a.h && !a.r ? t[0] : `calc(${t.join(" + ")})`;
};

// ---------- materials and shading ----------

type RGB = [number, number, number];
type Mat = { hi: RGB; lo: RGB };
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgb = (c: RGB) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
const pos = (v: number) => Math.max(0, v);

/** Natural titanium (the iPhone's frame colours) */
const NATURAL: Mat = { hi: [240, 234, 220], lo: [66, 62, 54] };
/** Night Sky titanium (the Duo's) */
const NIGHT: Mat = { hi: [170, 175, 171], lo: [30, 32, 31] };

/** brightness 0..1 of a face whose outward normal is (nx, ny) in the device plane */
function lit(nx: number, ny: number): number {
  // key light high and to the left, a weak fill from the lower right
  const key = nx * -0.5 + ny * -0.866;
  const fill = nx * 0.6 + ny * 0.8;
  return Math.min(1, 0.26 + 0.6 * pos(key) ** 1.3 + 0.2 * pos(fill));
}

/** a wall's colour across its thickness: a bright polished chamfer at the front
    edge, a dark one at the back, brushed metal between (top of the quad = back) */
function wallPaint(mat: Mat, nx: number, ny: number): string {
  const base = mix(mat.lo, mat.hi, lit(nx, ny));
  const back = mix(base, mat.lo, 0.5);
  const front = mix(base, mat.hi, 0.8);
  const mid = mix(base, mat.hi, 0.1);
  return [
    "repeating-linear-gradient(180deg, rgba(255,255,255,0.03) 0 1px, rgba(0,0,0,0.03) 1px 3px)",
    `linear-gradient(180deg, ${rgb(back)} 0%, ${rgb(base)} 12%, ${rgb(mid)} 52%, ${rgb(base)} 88%, ${rgb(front)} 100%)`,
  ].join(", ");
}

// ---------- the outline of a rounded rectangle, as wall quads ----------

type Pt = [L, L];
type Wall = { x: L; y: L; len: L; ang: number; nx: number; ny: number };

class Outline {
  walls: Wall[] = [];
  private cur: Pt = [L0, L0];
  from(x: L, y: L): this {
    this.cur = [x, y];
    return this;
  }
  /** straight run to (x, y), axis-aligned */
  line(x: L, y: L): this {
    const [x0, y0] = this.cur;
    const dx = Math.sign(x.c + x.w * 1e3 + x.h * 1e3 + x.r * 1e2 - (x0.c + x0.w * 1e3 + x0.h * 1e3 + x0.r * 1e2));
    const dy = Math.sign(y.c + y.w * 1e3 + y.h * 1e3 + y.r * 1e2 - (y0.c + y0.w * 1e3 + y0.h * 1e3 + y0.r * 1e2));
    const len = dx ? scale(sub(x, x0), dx) : scale(sub(y, y0), dy);
    this.walls.push({ x: x0, y: y0, len, ang: (Math.atan2(dy, dx) * 180) / Math.PI, nx: dy, ny: -dx });
    this.cur = [x, y];
    return this;
  }
  /** a quarter turn about (cx, cy), from angle a0 to a1 (degrees, clockwise from +x), in n chords */
  arc(cx: L, cy: L, a0: number, a1: number, n: number): this {
    const rad = Math.PI / 180;
    for (let i = 0; i < n; i++) {
      const ta = a0 + ((a1 - a0) * i) / n;
      const tb = a0 + ((a1 - a0) * (i + 1)) / n;
      const mid = ((ta + tb) / 2) * rad;
      const chord = 2 * Math.sin(((tb - ta) * rad) / 2);
      this.walls.push({
        x: add(cx, scale(R, Math.cos(ta * rad))),
        y: add(cy, scale(R, Math.sin(ta * rad))),
        len: scale(R, chord),
        ang: (ta + tb) / 2 + 90,
        nx: Math.cos(mid),
        ny: Math.sin(mid),
      });
    }
    this.cur = [add(cx, scale(R, Math.cos(a1 * rad))), add(cy, scale(R, Math.sin(a1 * rad)))];
    return this;
  }
}

const WALL_OVERLAP = 0.7; // px: adjacent quads overlap so no hairline shows between them

function wallEls(o: Outline, mat: Mat, zBack: number, depth: number, tag: string): JSX.Element[] {
  return o.walls.map((w, i) => (
    <i
      key={`${tag}${i}`}
      className="b3 b3-solid"
      style={
        {
          width: css(add(w.len, px(WALL_OVERLAP))),
          height: depth,
          transform: `translate3d(${css(w.x)}, ${css(w.y)}, ${zBack}px) rotateZ(${n3(w.ang)}deg) rotateX(90deg)`,
          background: wallPaint(mat, w.nx, w.ny),
        } as CSSProperties
      }
    />
  ));
}

// ---------- side buttons: little boxes standing off a wall ----------

type Btn = { top: number; h: number };

/** A button on the left (side "l", x in [-p, 0]) or right (side "r", x in [edge, edge + p])
    wall, between z0 and z1. `faces` 4 = outer, front and both caps; 2 = outer and front. */
function buttonEls(side: "l" | "r", edge: L, btns: Btn[], z0: number, z1: number, mat: Mat, faces: 2 | 4, tag: string, cls = "b3 b3-solid"): JSX.Element[] {
  const p = 5;
  const d = z1 - z0;
  const out: JSX.Element[] = [];
  const left = side === "l";
  const x0 = left ? add(edge, px(-p)) : edge;
  const outerX = left ? x0 : add(edge, px(p));
  const outerNx = left ? -1 : 1;
  const paint = (nx: number, ny: number) => wallPaint(mat, nx, ny);
  btns.forEach((b, k) => {
    const key = `${tag}${k}`;
    const at = (t: number) => `${t}px`;
    // front (what you see head-on today: a bar standing off the frame)
    out.push(
      <i
        key={`${key}f`}
        className={cls}
        style={{
          width: p,
          height: b.h,
          transform: `translate3d(${css(x0)}, ${at(b.top)}, ${z1}px)`,
          background: `linear-gradient(${left ? 90 : 270}deg, ${rgb(mix(mat.lo, mat.hi, 0.35))}, ${rgb(mix(mat.lo, mat.hi, 0.8))})`,
        }}
      />,
    );
    // outer face
    out.push(
      <i
        key={`${key}o`}
        className={cls}
        style={{
          width: d,
          height: b.h,
          transform: left
            ? `translate3d(${css(outerX)}, ${at(b.top)}, ${z0}px) rotateY(-90deg)`
            : `translate3d(${css(outerX)}, ${at(b.top)}, ${z1}px) rotateY(90deg)`,
          background: paint(outerNx, 0),
        }}
      />,
    );
    if (faces === 4) {
      out.push(
        <i
          key={`${key}t`}
          className={cls}
          style={{ width: p, height: d, transform: `translate3d(${css(x0)}, ${at(b.top)}, ${z0}px) rotateX(90deg)`, background: paint(0, -1) }}
        />,
        <i
          key={`${key}b`}
          className={cls}
          style={{ width: p, height: d, transform: `translate3d(${css(x0)}, ${at(b.top + b.h)}, ${z1}px) rotateX(-90deg)`, background: paint(0, 1) }}
        />,
      );
    }
  });
  return out;
}

// ---------- the iPhone ----------

const PHONE_T = 50; // ~8.4mm at this scale (the frame is 421px for 70.6mm)
// positions are relative to the frame (the screen's origin is 14px further in)
const PHONE_LEFT: Btn[] = [
  { top: 134, h: 32 }, // action button
  { top: 194, h: 62 }, // volume up
  { top: 268, h: 62 }, // volume down
];
const PHONE_RIGHT: Btn[] = [{ top: 224, h: 96 }]; // power

const phoneOutline = new Outline()
  .from(R, px(0))
  .line(sub(W, R), px(0))
  .arc(sub(W, R), R, -90, 0, 5)
  .line(W, sub(H, R))
  .arc(sub(W, R), sub(H, R), 0, 90, 5)
  .line(R, H)
  .arc(R, sub(H, R), 90, 180, 5)
  .line(px(0), R)
  .arc(R, R, 180, 270, 5);

/** Children of .dev-frame: its walls, buttons, the back panel with a camera plateau, and a drop shadow
    that stays behind the body. All hidden unless the phone link is tilting the device. */
export const PhoneHull = memo(function PhoneHull() {
  return (
    <>
      <i className="b3 b3-solid b3-ground" style={{ transform: `translateZ(${-PHONE_T - 1}px)` }} />
      {wallEls(phoneOutline, NATURAL, -PHONE_T, PHONE_T, "p")}
      {buttonEls("l", px(0), PHONE_LEFT, -PHONE_T / 2 - 8, -PHONE_T / 2 + 8, NATURAL, 4, "pl")}
      {buttonEls("r", W, PHONE_RIGHT, -PHONE_T / 2 - 8, -PHONE_T / 2 + 8, NATURAL, 4, "pr")}
      <i className="b3 b3-solid b3-back b3-back-phone" style={{ transform: `translateZ(${-PHONE_T}px) rotateY(180deg)` }}>
        <i className="b3-plateau">
          <i className="b3-lens" style={{ left: 7, top: 7 }} />
          <i className="b3-lens" style={{ left: 7, top: 43 }} />
          <i className="b3-lens" style={{ left: 43, top: 25 }} />
          <i className="b3-flash" style={{ left: 52, top: 9 }} />
        </i>
      </i>
    </>
  );
});

// ---------- the iPhone Duo ----------

export const DUO_T = 36; // each half (and the cover): ~6mm
const SPINE = 5; // half the hinge barrel's width, either side of the crease
const C = scale(W, 0.5);

const DUO_LEFT_BTNS: Btn[] = [
  { top: 96, h: 58 },
  { top: 170, h: 40 },
];

// the cover, in its own coordinates: hinge on the left (x = 0), the front plane at z = 0
// and the body behind it down to -DUO_T. Square on the hinge side, rounded on the other.
const leafOutline = new Outline()
  .from(px(-SPINE), px(0))
  .line(sub(W, R), px(0))
  .arc(sub(W, R), R, -90, 0, 4)
  .line(W, sub(H, R))
  .arc(sub(W, R), sub(H, R), 0, 90, 4)
  .line(px(-SPINE), H)
  .line(px(-SPINE), px(0));

/** Children of .duo-leaf: the cover's thickness. Always drawn: the swing passes through edge-on. */
export const LeafHull = memo(function LeafHull() {
  const z0 = -DUO_T;
  const walls = leafOutline.walls.map((w, i) => {
    const hinge = w.nx === -1;
    return (
      <i
        key={`l${i}`}
        className={hinge ? "b3 b3-spine" : "b3"}
        style={
          {
            width: css(add(w.len, px(WALL_OVERLAP))),
            height: DUO_T,
            transform: `translate3d(${css(w.x)}, ${css(w.y)}, ${z0}px) rotateZ(${n3(w.ang)}deg) rotateX(90deg)`,
            background: hinge ? undefined : wallPaint(NIGHT, w.nx, w.ny),
          } as CSSProperties
        }
      />
    );
  });
  // the power and volume buttons ride the cover's free edge
  const btns = buttonEls("r", W, DUO_LEFT_BTNS, z0 + 10, z0 + DUO_T - 10, NIGHT, 2, "lb", "b3");
  return (
    <>
      {walls}
      {btns}
    </>
  );
});

const slabR = new Outline()
  .from(add(C, px(SPINE)), px(0))
  .line(sub(W, R), px(0))
  .arc(sub(W, R), R, -90, 0, 4)
  .line(W, sub(H, R))
  .arc(sub(W, R), sub(H, R), 0, 90, 4)
  .line(add(C, px(SPINE)), H);

const slabL = new Outline()
  .from(R, px(0))
  .line(sub(C, px(SPINE)), px(0))
  .from(sub(C, px(SPINE)), H)
  .line(R, H)
  .arc(R, sub(H, R), 90, 180, 4)
  .line(px(0), R)
  .arc(R, R, 180, 270, 4);

/** The open device behind the screen: two halves with a hinge barrel down the back of the crease.
    Drawn only while the phone link tilts the device (a flat device doesn't need it). The left half
    appears when the cover has landed and gone (.is-landed). */
export const DuoSlab = memo(function DuoSlab() {
  const zBack = -2 * DUO_T;
  const bx = css(sub(C, px(SPINE)));
  const capW = SPINE * 2 + WALL_OVERLAP;
  const capD = DUO_T + 3;
  const zFront = zBack + DUO_T;
  return (
    <>
      {/* right half: walls and back panel (and, closed, the hinge side of the closed device) */}
      <span className="duo-half duo-half-r">
        {wallEls(slabR, NIGHT, zBack, DUO_T, "r")}
        <i
          className="b3 b3-solid b3-back b3-back-duo"
          style={{ left: css(add(C, px(SPINE))), width: css(sub(W, add(C, px(SPINE)))), borderRadius: "0 50px 50px 0", transform: `translateZ(${zBack}px) rotateY(180deg)` }}
        />
      </span>
      {/* the hinge barrel: a ribbed strip proud of the back, its top and bottom ends in the walls */}
      <span className="duo-spine">
        <i
          className="b3 b3-solid b3-spine b3-back"
          style={{ left: bx, width: SPINE * 2, transform: `translateZ(${zBack - 3}px) rotateY(180deg)` }}
        />
        <i
          className="b3 b3-solid b3-spine b3-cap"
          style={{ width: capW, height: capD, transform: `translate3d(${bx}, 0px, ${zBack - 3}px) rotateX(90deg)` }}
        />
        <i
          className="b3 b3-solid b3-spine b3-cap"
          style={{ width: capW, height: capD, transform: `translate3d(${bx}, ${css(H)}, ${zFront}px) rotateX(-90deg)` }}
        />
        {/* the spine wall the closed device shows on its hinge side */}
        <i
          className="b3 b3-solid b3-spine b3-spine-wall"
          style={{
            width: DUO_T + 3,
            height: css(H),
            transform: `translate3d(${bx}, 0px, ${zBack - 3}px) rotateY(-90deg)`,
          }}
        />
      </span>
      {/* left half: appears once the cover has landed */}
      <span className="duo-half duo-half-l">
        {wallEls(slabL, NIGHT, zBack, DUO_T, "l")}
        {buttonEls("l", px(0), DUO_LEFT_BTNS, zBack + 10, zBack + DUO_T - 10, NIGHT, 4, "sb")}
        <i
          className="b3 b3-solid b3-back b3-back-duo"
          style={{ left: 0, width: bx, borderRadius: "50px 0 0 50px", transform: `translateZ(${zBack}px) rotateY(180deg)` }}
        />
      </span>
    </>
  );
});
