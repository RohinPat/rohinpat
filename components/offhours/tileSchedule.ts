// Start-up and pacing for the tile previews on /interests.
//
// Nine previews all booting on the first frame is what makes the page heavy on
// a slow phone, so a tile waits its turn: `whenIdle` runs queued starts one at
// a time, when the browser has a spare moment, a short beat apart. On a laptop
// that is a few hundred milliseconds in total and nobody can see it; on a
// phone it spreads the work out so the page stays responsive while it loads.

/** gap between two tiles' first live frames, ms */
const START_GAP_MS = 120;

/** a live tile aims to use at most 1 / this much of the main thread: the next frame waits this many times what the last one cost */
const TILE_DUTY = 5;
/** frames per second a tile preview draws at most */
const TILE_FPS = 30;
/** the longest a tile waits between frames, however costly they are (so it still moves, if slowly), ms */
const TILE_MAX_GAP_MS = 1000;
/** a frame whose next animation frame comes later than this was held up (about 50 fps on a 60 Hz screen) */
const SLOW_RAF_MS = 20;
/** frames before the cost is trusted: the first ones compile shaders and upload textures */
const WARM_UP = 1;

export type Pacer = {
  /** call at the top of every animation frame: true if the tile should draw this time */
  due: (now: number) => boolean;
  /** draw, and learn what it cost */
  draw: (draw: () => void) => void;
  /** smoothed ms a frame costs the main thread (0 until warmed up) */
  cost: () => number;
  /** frames drawn so far */
  frames: () => number;
};

/**
 * Paces one tile: at most TILE_FPS, and the next frame waits TILE_DUTY times
 * what the last one cost, up to TILE_MAX_GAP_MS. Cost is how long the draw
 * took, or how late the next animation frame arrived if that is longer, which
 * also catches work the browser does after the draw call (a WebGL flush, a
 * big canvas's raster). On a fast machine this is just a 30 fps cap.
 */
export function makePacer(): Pacer {
  let prev = 0;
  let lastDraw = -1e9;
  let gap = 1000 / TILE_FPS;
  let cost = 0;
  let n = 0;
  let drawMs = 0;
  let measure = false;
  return {
    due(now) {
      const interval = prev ? now - prev : 0;
      prev = now;
      if (measure) {
        measure = false;
        // a frame that held the main thread up: the wait starts when it is over, not when it began
        if (interval > SLOW_RAF_MS) lastDraw = now;
        if (n > WARM_UP) {
          const c = Math.max(drawMs, interval > SLOW_RAF_MS ? interval - 1000 / 60 : 0);
          cost += (c - cost) * 0.3;
          gap = Math.min(TILE_MAX_GAP_MS, Math.max(1000 / TILE_FPS, cost * TILE_DUTY));
        }
      }
      if (now - lastDraw < gap - 1.5) return false;
      lastDraw = now;
      return true;
    },
    draw(fn) {
      const t0 = performance.now();
      fn();
      drawMs = performance.now() - t0;
      measure = true;
      n++;
    },
    cost: () => cost,
    frames: () => n,
  };
}

type Job = { run: () => void; dead: boolean };
const queue: Job[] = [];
let pumping = false;

function idle(cb: () => void, timeout = 400) {
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(cb, { timeout });
  else window.setTimeout(cb, 40);
}

/** Run `run` when the browser is next idle (within `timeout` ms at the latest), without queueing behind other tiles. Returns a function that cancels it. */
export function whenQuiet(run: () => void, timeout = 2000): () => void {
  let dead = false;
  idle(() => !dead && run(), timeout);
  return () => {
    dead = true;
  };
}

function pump() {
  if (pumping) return;
  while (queue.length && queue[0].dead) queue.shift();
  const job = queue.shift();
  if (!job) return;
  pumping = true;
  idle(() => {
    if (!job.dead) job.run();
    window.setTimeout(() => {
      pumping = false;
      pump();
    }, START_GAP_MS);
  });
}

/** Run `run` when it is this tile's turn. Returns a function that cancels it. */
export function whenIdle(run: () => void): () => void {
  const job: Job = { run, dead: false };
  queue.push(job);
  pump();
  return () => {
    job.dead = true;
  };
}

/** a narrow screen is a phone: a tile that is costly to start waits this long after the page has loaded, ms */
const PHONE_SETTLE_MS = 4000;

/** true on a phone-sized screen (the one-column layout) */
export const isPhoneSized = () => window.matchMedia("(max-width: 767px)").matches;

/**
 * Wait until the page has settled: on a phone-sized screen, a few seconds after
 * the load event, so the first seconds go to scrolling and tapping rather than
 * to booting a 3D scene; elsewhere, no wait. Returns a function that cancels it.
 */
export function afterSettle(run: () => void): () => void {
  if (!isPhoneSized()) {
    run();
    return () => {};
  }
  let timer = 0;
  let dead = false;
  const arm = () => {
    timer = window.setTimeout(() => !dead && run(), PHONE_SETTLE_MS);
  };
  if (document.readyState === "complete") arm();
  else window.addEventListener("load", arm, { once: true });
  return () => {
    dead = true;
    window.clearTimeout(timer);
    window.removeEventListener("load", arm);
  };
}
