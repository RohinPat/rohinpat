import { vi } from "vitest";

// Drives the driving range with no screen: a canvas context that swallows every
// call, and a clock the test steps by hand. The range's own state machine does
// the rest, so a test measures what a visitor would see (when a swing is
// allowed, how far a shot carries) rather than a copy of the numbers.

type RangeMod = typeof import("@/components/offhours/golf/range");
type Range = import("@/components/offhours/golf/range").Range;

/** a 2D context that accepts any call or property and returns itself */
export function fakeCtx(): CanvasRenderingContext2D {
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === "measureText" ? () => ({ width: 40 }) : k === Symbol.toPrimitive ? () => 0 : p),
    set: () => true,
    apply: () => p,
  });
  return p as CanvasRenderingContext2D;
}

/** like fakeCtx, but remembers the text drawn and the circles drawn (x, y, radius) */
export function recordingCtx() {
  const texts: string[] = [];
  const arcs: [number, number, number][] = [];
  const swallow = fakeCtx();
  const ctx = new Proxy(swallow as object, {
    get: (t, k) => {
      if (k === "fillText" || k === "strokeText") return (s: string) => k === "fillText" && texts.push(s);
      if (k === "arc") return (x: number, y: number, r: number) => arcs.push([x, y, r]);
      return Reflect.get(t, k);
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, arcs, clear: () => ((texts.length = 0), (arcs.length = 0)) };
}

/** tree sprites are drawn onto a scratch canvas; give them the fake context too */
export function stubScratchCanvas() {
  vi.stubGlobal(
    "ImageData",
    class {
      data: Uint8ClampedArray;
      constructor(
        public width: number,
        public height: number,
      ) {
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    },
  );
  const make = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string, o?: ElementCreationOptions) => {
    const el = make(tag, o);
    if (tag === "canvas") (el as HTMLCanvasElement).getContext = (() => fakeCtx()) as never;
    return el;
  }) as typeof document.createElement);
}

/** a small seeded generator for Math.random, so a run repeats */
export function seedRandom(seed = 7) {
  let s = seed >>> 0;
  vi.spyOn(Math, "random").mockImplementation(() => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  });
}

export type Sim = ReturnType<typeof makeSim>;

export function makeSim(M: RangeMod, step = 1 / 60, ctx: CanvasRenderingContext2D = fakeCtx()) {
  const said: string[] = [];
  const env = { play: true, say: (m: string) => said.push(m) };
  const r: Range = M.newRange();
  let t = 0;
  const frame = () => {
    M.rangeDraw(ctx, r, 1440, 900, step, t, env);
    t += step;
  };
  const key = (k: string, shiftKey = false) => M.rangeKey(r, { key: k, repeat: false, shiftKey } as KeyboardEvent, true, t, env);
  const press = () => M.rangePointer(r, "down", 720, 400, 1440, 900, t, env);
  const release = () => M.rangePointer(r, "up", 720, 400, 1440, 900, t, env);
  const calm = () => {
    r.wind = { x: 0, z: 0 };
  };
  /** step until `until()` or `max` seconds; returns the seconds it took, or null */
  const run = (until: () => boolean, max = 40) => {
    const t0 = t;
    while (!until() && t - t0 < max) frame();
    return until() ? t - t0 : null;
  };
  return { r, env, said, ctx, frame, key, press, release, calm, run, time: () => t, M };
}

/** a pure, full swing the way a linked phone makes one (power 1, square, clean contact) */
export const PURE = { power: 1, face: 0, curve: 0, contact: 1 };
