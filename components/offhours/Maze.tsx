"use client";

import { useRef, useState } from "react";
import { seeded, useCanvas, type PieceProps } from "./useCanvas";
import { getAudio, tone } from "./audio";
import { display, mono } from "./font";

// A maze in 1-bit. Left: a first-person raycaster (DDA, one ray per column,
// ordered Bayer dithering for the shading — two colours, no greys). Right:
// the map, where you watch the solver think. Search algorithms (BFS, DFS,
// A*) expand cells in order, then walk the path they found; the wall
// follower feels its way round; Q-learning actually learns the maze, one
// episode at a time, and walks its learned policy. Or walk it yourself.

type Algo = "you" | "bfs" | "dfs" | "astar" | "wall" | "q";
const ALGOS: { id: Algo; name: string; note: string }[] = [
  { id: "you", name: "You", note: "Arrows or WASD" },
  { id: "bfs", name: "BFS", note: "Breadth-first: shortest path, explores everything" },
  { id: "dfs", name: "DFS", note: "Depth-first: dives in, backtracks" },
  { id: "astar", name: "A*", note: "Heuristic search: heads for the exit" },
  { id: "wall", name: "Wall follower", note: "Right hand on the wall, no map" },
  { id: "q", name: "Q-learning", note: "Reinforcement learning: learns by trial and error" },
];

const DARK = [13, 16, 14];
const LIGHT = [207, 238, 221];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

type Maze = { W: number; H: number; g: Uint8Array; start: [number, number]; goal: [number, number] };
type Pt = [number, number];

function makeMaze(cw: number, ch: number, rnd: () => number): Maze {
  const W = cw * 2 + 1;
  const H = ch * 2 + 1;
  const g = new Uint8Array(W * H).fill(1);
  const stack: Pt[] = [[1, 1]];
  g[W + 1] = 0;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const dirs = ([[2, 0], [-2, 0], [0, 2], [0, -2]] as Pt[]).filter(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      return nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1 && g[ny * W + nx] === 1;
    });
    if (!dirs.length) {
      stack.pop();
      continue;
    }
    const [dx, dy] = dirs[Math.floor(rnd() * dirs.length)];
    g[(y + dy / 2) * W + x + dx / 2] = 0;
    g[(y + dy) * W + x + dx] = 0;
    stack.push([x + dx, y + dy]);
  }
  // knock out a few extra walls so there's more than one route (more interesting for the solvers)
  for (let k = 0; k < Math.round(cw * ch * 0.06); k++) {
    const x = 1 + Math.floor(rnd() * (W - 2));
    const y = 1 + Math.floor(rnd() * (H - 2));
    if (g[y * W + x] && (x + y) % 2 === 1) g[y * W + x] = 0;
  }
  return { W, H, g, start: [1, 1], goal: [W - 2, H - 2] };
}

const open = (m: Maze, x: number, y: number) => x >= 0 && y >= 0 && x < m.W && y < m.H && m.g[y * m.W + x] === 0;
const NB: Pt[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function rebuild(prev: Int32Array, m: Maze, end: Pt): Pt[] {
  const path: Pt[] = [];
  let k = end[1] * m.W + end[0];
  while (k >= 0) {
    path.push([k % m.W, Math.floor(k / m.W)]);
    k = prev[k];
  }
  return path.reverse();
}

// Search as a generator: yields each expanded cell, returns the path.
function* search(m: Maze, kind: "bfs" | "dfs" | "astar"): Generator<number, Pt[]> {
  const n = m.W * m.H;
  const prev = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  const gScore = new Float64Array(n).fill(Infinity);
  const s = m.start[1] * m.W + m.start[0];
  const goal = m.goal[1] * m.W + m.goal[0];
  const h = (k: number) => Math.abs((k % m.W) - m.goal[0]) + Math.abs(Math.floor(k / m.W) - m.goal[1]);
  let front: number[] = [s];
  gScore[s] = 0;
  seen[s] = 1;
  while (front.length) {
    let k: number;
    if (kind === "bfs") k = front.shift()!;
    else if (kind === "dfs") k = front.pop()!;
    else {
      let bi = 0;
      for (let i = 1; i < front.length; i++) if (gScore[front[i]] + h(front[i]) < gScore[front[bi]] + h(front[bi])) bi = i;
      k = front.splice(bi, 1)[0];
    }
    yield k;
    if (k === goal) return rebuild(prev, m, m.goal);
    const x = k % m.W, y = Math.floor(k / m.W);
    const order = kind === "dfs" ? [...NB].reverse() : NB;
    for (const [dx, dy] of order) {
      const nk = (y + dy) * m.W + x + dx;
      if (!open(m, x + dx, y + dy)) continue;
      if (kind === "astar") {
        if (gScore[k] + 1 < gScore[nk]) {
          gScore[nk] = gScore[k] + 1;
          prev[nk] = k;
          if (!front.includes(nk)) front.push(nk);
        }
      } else if (!seen[nk]) {
        seen[nk] = 1;
        prev[nk] = k;
        front.push(nk);
      }
    }
  }
  front = [];
  return [];
}

// Tabular Q-learning on the maze tiles. Reward -1 per step (bumping a wall
// costs -3 and you stay put), 0 at the exit. Q starts at 0, which is
// optimistic, so it explores systematically; epsilon decays too.
class QLearner {
  q: Float32Array;
  episodes = 0;
  steps = 0;
  curve: number[] = [];
  eps = 1;
  pos: number;
  epSteps = 0;
  constructor(public m: Maze) {
    this.q = new Float32Array(m.W * m.H * 4);
    this.pos = m.start[1] * m.W + m.start[0];
  }
  best(k: number) {
    let b = 0;
    for (let a = 1; a < 4; a++) if (this.q[k * 4 + a] > this.q[k * 4 + b]) b = a;
    return b;
  }
  value(k: number) {
    return this.q[k * 4 + this.best(k)];
  }
  train(n: number) {
    const { m } = this;
    const goal = m.goal[1] * m.W + m.goal[0];
    const cap = m.W * m.H * 3;
    for (let i = 0; i < n; i++) {
      const k = this.pos;
      const a = Math.random() < this.eps ? Math.floor(Math.random() * 4) : this.best(k);
      const x = k % m.W, y = Math.floor(k / m.W);
      const nx = x + NB[a][0], ny = y + NB[a][1];
      const ok = open(m, nx, ny);
      const nk = ok ? ny * m.W + nx : k;
      const done = nk === goal;
      const r = done ? 0 : ok ? -1 : -3;
      const target = r + (done ? 0 : 0.98 * this.value(nk));
      this.q[k * 4 + a] += 0.6 * (target - this.q[k * 4 + a]);
      this.pos = nk;
      this.steps++;
      this.epSteps++;
      if (done || this.epSteps > cap) {
        this.episodes++;
        this.curve.push(this.epSteps);
        if (this.curve.length > 120) this.curve.shift();
        this.epSteps = 0;
        this.pos = m.start[1] * m.W + m.start[0];
        this.eps = Math.max(0.02, this.eps * 0.93);
      }
    }
  }
  greedy(): Pt[] | null {
    const { m } = this;
    const goal = m.goal[1] * m.W + m.goal[0];
    let k = m.start[1] * m.W + m.start[0];
    const path: Pt[] = [[k % m.W, Math.floor(k / m.W)]];
    const seen = new Set([k]);
    while (k !== goal) {
      const a = this.best(k);
      const nx = (k % m.W) + NB[a][0], ny = Math.floor(k / m.W) + NB[a][1];
      if (!open(m, nx, ny)) return null;
      k = ny * m.W + nx;
      if (seen.has(k)) return null;
      seen.add(k);
      path.push([nx, ny]);
    }
    return path;
  }
}

type Run = {
  maze: Maze;
  algo: Algo;
  phase: "think" | "walk" | "done" | "manual";
  gen: Generator<number, Pt[]> | null;
  order: Int32Array; // expansion order per tile, -1 = not expanded
  count: number;
  acc: number;
  path: Pt[];
  pi: number;
  cam: { x: number; y: number; a: number };
  q: QLearner | null;
  wall: { x: number; y: number; d: number } | null;
  trail: Pt[];
  t0: number;
  doneAt: number;
  result: string;
  keys: Set<string>;
  flash: number;
};

function newRun(maze: Maze, algo: Algo, t: number): Run {
  return {
    maze,
    algo,
    phase: algo === "you" ? "manual" : algo === "wall" ? "walk" : "think",
    gen: algo === "bfs" || algo === "dfs" || algo === "astar" ? search(maze, algo) : null,
    order: new Int32Array(maze.W * maze.H).fill(-1),
    count: 0,
    acc: 0,
    path: [],
    pi: 0,
    cam: { x: maze.start[0] + 0.5, y: maze.start[1] + 0.5, a: open(maze, 2, 1) ? 0 : Math.PI / 2 },
    q: algo === "q" ? new QLearner(maze) : null,
    wall: algo === "wall" ? { x: maze.start[0], y: maze.start[1], d: 0 } : null,
    trail: [],
    t0: t,
    doneAt: 0,
    result: "",
    keys: new Set(),
    flash: 0,
  };
}

export default function Maze({ mode, paused }: PieceProps) {
  const play = mode === "play";
  const [algo, setAlgo] = useState<Algo>(play ? "astar" : "astar");
  const [status, setStatus] = useState("");
  const run = useRef<Run | null>(null);
  const tick = useRef(0);
  const seedRef = useRef(7);
  const preview = useRef(0); // preview cycles algorithms
  const off = useRef<{ c: HTMLCanvasElement; img: ImageData } | null>(null);
  // every solver's result on the current maze, for comparison
  const board = useRef<{ maze: Maze | null; rows: [Algo, string][] }>({ maze: null, rows: [] });

  const fresh = (a: Algo, t: number, regen: boolean) => {
    const rnd = play ? Math.random : seeded(seedRef.current++);
    const maze = regen || !run.current ? (play ? makeMaze(14, 9, rnd) : makeMaze(9, 6, rnd)) : run.current.maze;
    run.current = newRun(maze, a, t);
    setStatus("");
  };

  const pick = (a: Algo) => {
    setAlgo(a);
    fresh(a, tick.current, false);
  };

  const ref = useCanvas(
    ({ ctx, w, h, t, dt }) => {
      tick.current = t;
      if (!run.current) fresh(algo, t, true);
      const R = run.current!;
      const m = R.maze;
      step(R, dt, t);

      // layout: view + map side by side, or stacked when narrow
      const side = w > h * 1.25 && w > 560;
      const vw = side ? Math.round(w * (play ? 0.6 : 0.58)) : w;
      const vh = side ? h : Math.round(h * 0.5);
      drawView(ctx, R, vw, vh);
      const mx = side ? vw : 0;
      const my = side ? 0 : vh;
      drawMap(ctx, R, mx, my, w - mx, h - my, play && side);

      // a finished run: report, then (preview) move on
      if (R.phase === "done" && !R.result) {
        R.result = summary(R);
        if (board.current.maze !== R.maze) board.current = { maze: R.maze, rows: [] };
        board.current.rows = [...board.current.rows.filter(([a]) => a !== R.algo), [R.algo, short(R)]];
        if (play) {
          setStatus(R.result);
          const au = getAudio();
          if (au) [523, 659, 784].forEach((f, i) => tone(au, { freq: f, dur: 0.25, gain: 0.18, at: i * 0.09, type: "square" }));
        }
      }
      if (!play && R.phase === "done" && t - R.doneAt > 1.6) {
        const cycle: Algo[] = ["astar", "bfs", "wall", "dfs"];
        preview.current = (preview.current + 1) % cycle.length;
        fresh(cycle[preview.current], t, true);
      }
      void m;
    },
    {
      interactive: play,
      paused,
      animateAlways: play,
      keys: (e, down) => {
        const R = run.current;
        if (!R || R.algo !== "you") return false;
        const k = e.key.toLowerCase();
        if (!["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(k)) return false;
        if (down) R.keys.add(k);
        else R.keys.delete(k);
        return true;
      },
    },
  );

  function step(R: Run, dt: number, t: number) {
    const m = R.maze;
    const open_ = m.W * m.H * 0.55;
    if (R.phase === "think" && R.gen) {
      // expand at a rate that finishes a full BFS in ~3.5s
      R.acc += dt * (open_ / (play ? 3.5 : 2.2));
      while (R.acc >= 1) {
        R.acc -= 1;
        const r = R.gen.next();
        if (r.done) {
          R.path = r.value;
          R.phase = "walk";
          R.pi = 1;
          break;
        }
        R.order[r.value] = R.count++;
        if (play && R.count % 6 === 0) {
          const au = getAudio();
          if (au) tone(au, { freq: 300 + (R.count % 40) * 18, dur: 0.03, gain: 0.03, type: "square" });
        }
      }
    } else if (R.phase === "think" && R.q) {
      R.q.train(play ? 2500 : 1500);
      const last = R.q.curve.slice(-6);
      const path = R.q.eps < 0.2 ? R.q.greedy() : null;
      if (path && last.length === 6 && last.every((v) => v < path.length * 1.6)) {
        R.path = path;
        R.phase = "walk";
        R.pi = 1;
      }
      if (R.q.episodes > 900) {
        R.path = R.q.greedy() ?? [];
        R.phase = R.path.length ? "walk" : "done";
        R.pi = 1;
      }
    } else if (R.phase === "walk") {
      if (R.wall && R.pi >= R.path.length) {
        // wall follower decides its next tile only when it gets there
        const W = R.wall;
        if (W.x === m.goal[0] && W.y === m.goal[1]) {
          finish(R, t);
          return;
        }
        for (const turn of [1, 0, 3, 2]) {
          const d = (W.d + turn) % 4;
          if (open(m, W.x + NB[d][0], W.y + NB[d][1])) {
            W.d = d;
            W.x += NB[d][0];
            W.y += NB[d][1];
            break;
          }
        }
        R.path.push([W.x, W.y]);
        R.order[W.y * m.W + W.x] = R.count++;
        if (R.path.length === 1) R.pi = 0;
      }
      walk(R, dt, t);
    } else if (R.phase === "manual") {
      const turn = (R.keys.has("arrowleft") || R.keys.has("a") ? -1 : 0) + (R.keys.has("arrowright") || R.keys.has("d") ? 1 : 0);
      const fwd = (R.keys.has("arrowup") || R.keys.has("w") ? 1 : 0) - (R.keys.has("arrowdown") || R.keys.has("s") ? 1 : 0);
      R.cam.a += turn * 2.6 * dt;
      const sp = fwd * 2.6 * dt;
      const nx = R.cam.x + Math.cos(R.cam.a) * sp;
      const ny = R.cam.y + Math.sin(R.cam.a) * sp;
      const r = 0.22;
      if (open(m, Math.floor(nx + Math.sign(nx - R.cam.x) * r), Math.floor(R.cam.y))) R.cam.x = nx;
      if (open(m, Math.floor(R.cam.x), Math.floor(ny + Math.sign(ny - R.cam.y) * r))) R.cam.y = ny;
      const k = Math.floor(R.cam.y) * m.W + Math.floor(R.cam.x);
      if (R.order[k] < 0) R.order[k] = R.count++;
      if (Math.floor(R.cam.x) === m.goal[0] && Math.floor(R.cam.y) === m.goal[1]) finish(R, t);
    }
    R.flash = Math.max(0, R.flash - dt * 1.5);
  }

  function walk(R: Run, dt: number, t: number) {
    if (R.pi >= R.path.length) {
      if (!R.wall) finish(R, t);
      return;
    }
    const [tx, ty] = R.path[R.pi];
    const cx = tx + 0.5, cy = ty + 0.5;
    const want = Math.atan2(cy - R.cam.y, cx - R.cam.x);
    let da = want - R.cam.a;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const turnRate = R.wall ? 16 : play ? 9 : 10;
    R.cam.a += Math.sign(da) * Math.min(Math.abs(da), turnRate * dt);
    const dist = Math.hypot(cx - R.cam.x, cy - R.cam.y);
    if (Math.abs(da) < 0.6) {
      // brisk enough that a long path still takes only a few seconds
      const pace = R.wall ? 14 : Math.max(5, R.path.length / 6);
      const sp = Math.min(dist, (play ? pace : 6) * dt);
      R.cam.x += Math.cos(want) * sp;
      R.cam.y += Math.sin(want) * sp;
    }
    if (dist < 0.05) {
      R.trail.push([tx, ty]);
      R.pi++;
    }
  }

  function finish(R: Run, t: number) {
    if (R.phase === "done") return;
    R.phase = "done";
    R.doneAt = t;
    R.flash = 1;
  }

  function summary(R: Run) {
    const secs = (R.doneAt - R.t0).toFixed(1);
    const name = ALGOS.find((a) => a.id === R.algo)!.name;
    if (R.algo === "you") return `You escaped in ${secs}s.`;
    if (R.algo === "q") return `Q-learning: learned it in ${R.q!.episodes} episodes, then walked ${R.path.length - 1} steps.`;
    if (R.algo === "wall") return `Wall follower: ${R.path.length} steps, no map needed.`;
    return `${name}: expanded ${R.count} cells, path ${R.path.length - 1} steps.`;
  }

  function short(R: Run) {
    if (R.algo === "you") return `${(R.doneAt - R.t0).toFixed(1)}s`;
    if (R.algo === "q") return `${R.q!.episodes} episodes · ${R.path.length - 1} steps`;
    if (R.algo === "wall") return `${R.path.length} steps walked`;
    return `${R.count} expanded · ${R.path.length - 1} steps`;
  }

  function drawView(ctx: CanvasRenderingContext2D, R: Run, vw: number, vh: number) {
    const m = R.maze;
    // low-res framebuffer, scaled up crisp
    const rw = Math.max(80, Math.round(Math.min(vw, play ? 320 : 200)));
    const rh = Math.max(50, Math.round((rw * vh) / vw));
    if (!off.current || off.current.c.width !== rw || off.current.c.height !== rh) {
      const c = document.createElement("canvas");
      c.width = rw;
      c.height = rh;
      off.current = { c, img: c.getContext("2d")!.createImageData(rw, rh) };
    }
    const { c, img } = off.current;
    const d = img.data;
    const { x: px, y: py, a } = R.cam;
    const fov = 1.05;
    const zbuf = new Float32Array(rw);
    const put = (i: number, on: boolean) => {
      const col = on ? LIGHT : DARK;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = 255;
    };
    const half = rh / 2;
    for (let x = 0; x < rw; x++) {
      const ra = a + (x / rw - 0.5) * fov;
      const dx = Math.cos(ra), dy = Math.sin(ra);
      let mx = Math.floor(px), my = Math.floor(py);
      const ddx = Math.abs(1 / dx), ddy = Math.abs(1 / dy);
      const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
      let sdx = (dx < 0 ? px - mx : mx + 1 - px) * ddx;
      let sdy = (dy < 0 ? py - my : my + 1 - py) * ddy;
      let sideHit = 0;
      for (let i = 0; i < 64; i++) {
        if (sdx < sdy) {
          sdx += ddx;
          mx += sx;
          sideHit = 0;
        } else {
          sdy += ddy;
          my += sy;
          sideHit = 1;
        }
        if (!open(m, mx, my)) break;
      }
      const dist = (sideHit === 0 ? sdx - ddx : sdy - ddy) * Math.cos(ra - a);
      zbuf[x] = dist;
      const lineH = Math.min(rh * 4, rh / Math.max(0.05, dist));
      const top = half - lineH / 2;
      const bot = half + lineH / 2;
      // wall texture coordinate for brick seams
      const hitX = sideHit === 0 ? py + (sdx - ddx) * dy : px + (sdy - ddy) * dx;
      const u = hitX - Math.floor(hitX);
      for (let y = 0; y < rh; y++) {
        const i = (y * rw + x) * 4;
        const th = BAYER[(y & 3) * 4 + (x & 3)];
        let lum: number;
        if (y < top) {
          // ceiling: near-black, a faint glow at the horizon
          lum = 0.16 * Math.max(0, 1 - (half - y) / half) ** 2;
        } else if (y > bot) {
          // floor: a lit band near you that falls off into the dark
          const fd = half / Math.max(1, y - half);
          lum = Math.max(0, 0.42 - fd * 0.06);
        } else {
          // bricks: 4 courses a wall, joints offset each course; fogged by distance
          const v = (y - top) / (bot - top);
          const course = Math.floor(v * 4);
          const bu = (u * 2 + (course % 2) * 0.5) % 1;
          const joint = v * 4 - course < 0.08 || bu < 0.05;
          lum = (sideHit ? 0.58 : 0.86) / (1 + dist * 0.32);
          if (joint) lum *= 0.3;
        }
        put(i, lum > th);
      }
    }
    // the exit: a spinning diamond, depth-tested against the walls
    const gx = m.goal[0] + 0.5 - px, gy = m.goal[1] + 0.5 - py;
    const gd = Math.hypot(gx, gy);
    let ga = Math.atan2(gy, gx) - a;
    while (ga > Math.PI) ga -= Math.PI * 2;
    while (ga < -Math.PI) ga += Math.PI * 2;
    if (Math.abs(ga) < fov * 0.75 && gd > 0.3) {
      const sxc = (ga / fov + 0.5) * rw;
      const size = (rh / gd) * 0.45;
      const bob = Math.sin(tick.current * 3) * size * 0.08;
      const spin = Math.abs(Math.cos(tick.current * 2.2));
      for (let x = Math.floor(sxc - size / 2); x < sxc + size / 2; x++) {
        if (x < 0 || x >= rw || zbuf[x] < gd * Math.cos(ga)) continue;
        const fx = Math.abs((x - sxc) / (size / 2)) / Math.max(0.15, spin);
        if (fx > 1) continue;
        const hh = (1 - fx) * size * 0.6;
        for (let y = Math.floor(half - hh + bob); y < half + hh + bob; y++) {
          if (y < 0 || y >= rh) continue;
          const th = BAYER[(y & 3) * 4 + (x & 3)];
          put((y * rw + x) * 4, 0.95 - fx * 0.3 > th);
        }
      }
    }
    if (R.flash > 0) {
      for (let i = 0; i < d.length; i += 4) {
        const x = (i / 4) % rw, y = Math.floor(i / 4 / rw);
        if (R.flash > BAYER[(y & 3) * 4 + (x & 3)]) {
          d[i] = LIGHT[0];
          d[i + 1] = LIGHT[1];
          d[i + 2] = LIGHT[2];
        }
      }
    }
    c.getContext("2d")!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, 0, 0, vw, vh);
    // crosshair-ish HUD
    mono(ctx, play ? 12 : 10);
    const name = ALGOS.find((x) => x.id === R.algo)!.name.toUpperCase();
    const label = R.phase === "think" ? (R.algo === "q" ? "LEARNING" : "THINKING") : R.phase === "done" ? "ESCAPED" : R.phase === "manual" ? "YOUR MOVE" : "WALKING";
    const hud = `${name} · ${label}`;
    ctx.fillStyle = "#0d100e";
    ctx.fillRect(8, vh - 30, ctx.measureText(hud).width + 16, 22);
    ctx.fillStyle = "#cfeedd";
    ctx.fillText(hud, 16, vh - 14);
  }

  function drawMap(ctx: CanvasRenderingContext2D, R: Run, x0: number, y0: number, w: number, h: number, big: boolean) {
    const m = R.maze;
    ctx.fillStyle = "#0d100e";
    ctx.fillRect(x0, y0, w, h);
    const pad = big ? 22 : 12;
    const statsH = big ? 92 : 28;
    const s = Math.floor(Math.min((w - pad * 2) / m.W, (h - pad * 2 - statsH) / m.H));
    const ox = x0 + Math.floor((w - s * m.W) / 2);
    const oy = y0 + pad;
    // value function for Q-learning, expansion order for the rest
    let vmin = 0;
    if (R.q) for (let k = 0; k < m.W * m.H; k++) if (!m.g[k]) vmin = Math.min(vmin, R.q.value(k));
    for (let y = 0; y < m.H; y++)
      for (let x = 0; x < m.W; x++) {
        const k = y * m.W + x;
        if (m.g[k]) {
          ctx.fillStyle = "#26302a";
        } else if (R.q) {
          const v = R.q.value(k);
          const f = v === 0 ? 0 : 1 - v / (vmin || -1);
          ctx.fillStyle = f > 0 ? `rgba(138,217,168,${0.12 + f * 0.75})` : "#151a17";
        } else if (R.order[k] >= 0) {
          const f = R.order[k] / Math.max(1, R.count);
          ctx.fillStyle = `rgba(138,217,168,${0.18 + (1 - f) * 0.5})`;
        } else {
          ctx.fillStyle = "#151a17";
        }
        ctx.fillRect(ox + x * s, oy + y * s, s, s);
      }
    // path
    if (R.path.length > 1 && R.phase !== "think") {
      ctx.strokeStyle = "#f2ead7";
      ctx.lineWidth = Math.max(1.5, s * 0.28);
      ctx.lineJoin = "round";
      ctx.beginPath();
      R.path.forEach(([x, y], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ox + (x + 0.5) * s, oy + (y + 0.5) * s));
      ctx.stroke();
    }
    // exit + agent
    ctx.fillStyle = "#f2ead7";
    ctx.fillRect(ox + m.goal[0] * s + s * 0.2, oy + m.goal[1] * s + s * 0.2, s * 0.6, s * 0.6);
    const ax = ox + R.cam.x * s, ay = oy + R.cam.y * s;
    ctx.fillStyle = "#8ad9a8";
    ctx.beginPath();
    ctx.moveTo(ax + Math.cos(R.cam.a) * s * 0.9, ay + Math.sin(R.cam.a) * s * 0.9);
    ctx.lineTo(ax + Math.cos(R.cam.a + 2.4) * s * 0.55, ay + Math.sin(R.cam.a + 2.4) * s * 0.55);
    ctx.lineTo(ax + Math.cos(R.cam.a - 2.4) * s * 0.55, ay + Math.sin(R.cam.a - 2.4) * s * 0.55);
    ctx.fill();

    // stats
    const sy = oy + s * m.H + (big ? 18 : 12);
    ctx.fillStyle = "#b5b6ab";
    mono(ctx, big ? 11 : 9);
    const tx = ox;
    if (R.q && big) {
      ctx.fillText(`EPISODES ${R.q.episodes}   STEPS ${R.q.steps.toLocaleString()}   EXPLORE ${Math.round(R.q.eps * 100)}%`, tx, sy);
      // learning curve: steps per episode, falling as it learns
      const cw = s * m.W, ch = 46;
      const cv = R.q.curve;
      const max = Math.max(1, ...cv);
      ctx.strokeStyle = "#8ad9a8";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      cv.forEach((v, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, tx + (i / 119) * cw, sy + 14 + ch - (v / max) * ch));
      ctx.stroke();
      ctx.fillText("STEPS PER EPISODE", tx, sy + 14 + ch + 14);
    } else if (big) {
      const what = R.algo === "you" ? `CELLS SEEN ${R.count}` : R.algo === "wall" ? `STEPS ${R.path.length}` : `EXPANDED ${R.count}`;
      ctx.fillText(`${what}${R.path.length > 1 && R.algo !== "wall" ? `   PATH ${R.path.length - 1}` : ""}`, tx, sy);
      ctx.fillText(ALGOS.find((a) => a.id === R.algo)!.note.toUpperCase(), tx, sy + 18);
    } else {
      ctx.fillText(R.algo === "q" ? `EP ${R.q?.episodes ?? 0}` : `EXPANDED ${R.count}`, tx, sy);
    }
    // scoreboard: how each solver did on this maze
    const rows = board.current.maze === m ? board.current.rows : [];
    if (big && rows.length) {
      let yy = sy + (R.q ? 100 : 52);
      ctx.fillStyle = "#8ad9a8";
      ctx.fillText("THIS MAZE", tx, yy);
      for (const [a, txt] of rows) {
        yy += 18;
        ctx.fillStyle = a === R.algo ? "#f2ead7" : "#b5b6ab";
        ctx.fillText(ALGOS.find((x) => x.id === a)!.name.toUpperCase().padEnd(14, " ") + txt.toUpperCase(), tx, yy);
      }
    }
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-[#0d100e]">
      {play && (
        <div className="flex flex-wrap items-center gap-2 px-3 pt-3 pb-2">
          {ALGOS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => pick(a.id)}
              aria-pressed={algo === a.id}
              title={a.note}
              className={`h-9 px-3.5 rounded-full font-mono text-[11px] uppercase tracking-[0.14em] border transition-colors ${
                algo === a.id ? "bg-[#cfeedd] text-[#0d100e] border-transparent" : "border-white/15 text-[#cfeedd] hover:bg-white/10"
              }`}
            >
              {a.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => fresh(algo, tick.current, true)}
            className="h-9 px-3.5 rounded-full font-mono text-[11px] uppercase tracking-[0.14em] bg-[#1d5e3f] text-[#f2ead7] ml-auto"
          >
            New maze
          </button>
          <p aria-live="polite" className="sr-only">
            {status}
          </p>
        </div>
      )}
      <div className="relative flex-1 min-h-0">
        <canvas
          ref={ref}
          data-autofocus={play || undefined}
          role={play ? "img" : undefined}
          aria-label={play ? "A first-person maze in 1-bit, with the map beside it. When You is selected, arrow keys or WASD walk." : undefined}
          className="absolute inset-0 w-full h-full outline-none"
        />
      </div>
    </div>
  );
}
