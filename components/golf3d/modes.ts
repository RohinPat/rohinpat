import { seeded } from "@/components/offhours/useCanvas";
import { NINE_DEFS, RANGE_DEF, type HoleDef } from "@/components/offhours/golf/course";
import type { HoleScore } from "@/components/offhours/golf/score";
import type { CourseGame, HoleStat } from "@/components/offhours/golf/play";

// The ways to play the course, all from the URL (nothing is stored):
// - full: the nine holes, a fresh wind each time;
// - quick: three of them, picked by the seed;
// - daily: the nine with the day's winds, the same for everyone that day;
// - range and green: practice, on the range's target flags or the nine's greens.
// A round's link carries its mode and seed, so a friend can play the same one.

export type Mode = "full" | "quick" | "daily" | "range" | "green";
/** practice, not a round: no cards, no score, nothing to share */
export const isPractice = (m: Mode): m is "range" | "green" => m === "range" || m === "green";
export type Setup = { mode: Mode; seed: number; defs: HoleDef[]; /** the date of a daily round, YYYY-MM-DD */ day: string | null };

/** today's date where the player is, YYYY-MM-DD */
export function today(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 1e9;
};

/** the holes and the seed of a round */
export function setupFor(mode: Mode, opts: { seed?: number; day?: string } = {}): Setup {
  if (mode === "daily") {
    const day = opts.day && DAY.test(opts.day) ? opts.day : today();
    const seed = 1 + hash(`golf:${day}`);
    const r = seeded(seed);
    // the day's winds: from calm to a two-club breeze, from anywhere
    const defs = NINE_DEFS.map((d) => ({ ...d, wind: { speed: Math.round((0.6 + r() * 3.8) * 10) / 10, dir: Math.round(r() * 628) / 100 } }));
    return { mode, seed, defs, day };
  }
  const seed = opts.seed && opts.seed > 0 ? Math.floor(opts.seed) : 1 + Math.floor(Math.random() * 1e6);
  if (mode === "range") return { mode, seed, defs: [RANGE_DEF], day: null };
  if (mode === "quick") {
    const r = seeded(seed);
    const order = NINE_DEFS.map((d) => ({ d, k: r() })).sort((a, b) => a.k - b.k);
    const defs = order.slice(0, 3).map((o) => o.d).sort((a, b) => a.n - b.n);
    return { mode, seed, defs, day: null };
  }
  return { mode, seed, defs: NINE_DEFS, day: null };
}

/** read a round from the page's query: ?daily, ?daily=2026-11-08, ?quick=1234, ?seed=1234 */
export function setupFromQuery(q: URLSearchParams): Setup | null {
  if (q.has("daily")) return setupFor("daily", { day: q.get("daily") || undefined });
  if (q.has("quick")) return setupFor("quick", { seed: Number(q.get("quick")) || undefined });
  if (q.has("seed")) return setupFor("full", { seed: Number(q.get("seed")) || undefined });
  if (q.has("range")) return setupFor("range");
  if (q.has("green")) return setupFor("green");
  return null;
}

/** the query that replays a round */
export function queryFor(s: Setup) {
  if (isPractice(s.mode)) return `?${s.mode}`;
  return s.mode === "daily" ? `?daily=${s.day}` : s.mode === "quick" ? `?quick=${s.seed}` : `?seed=${s.seed}`;
}

export function modeName(s: Setup) {
  if (s.mode === "daily") {
    const [y, m, d] = (s.day ?? today()).split("-").map(Number);
    return `Daily · ${new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }
  if (s.mode === "range") return "Range";
  if (s.mode === "green") return "Putting green";
  return s.mode === "quick" ? "Quick 3" : "Nine holes";
}

/** the round as text to paste somewhere: the mode, the score, each hole, and the link */
export function shareText(s: Setup, scores: HoleScore[], origin: string) {
  const total = scores.reduce((a, b) => a + b.strokes, 0);
  const par = s.defs.slice(0, scores.length).reduce((a, b) => a + b.par, 0);
  const tp = total === par ? "E" : total > par ? `+${total - par}` : `${total - par}`;
  const holes = s.defs
    .slice(0, scores.length)
    .map((d, i) => `${d.n}:${scores[i].strokes}`)
    .join(" ");
  return `Golf, ${modeName(s)}: ${total} (${tp})\n${holes}\n${origin}/golf${queryFor(s)}`;
}

/** a hole worth paper over its card whatever the score: holed from off the green, or a putt from 25 ft or more */
export const celebrated = (s: HoleStat | undefined) => !!s?.holed && (s.holed.by === "shot" || s.holed.ft >= 25);

/** the round's best moments, a few words each: "Chip-in on 4", "31 ft putt on 7" (the longest putt first, at most three) */
export function highlights(game: CourseGame): string[] {
  const out: { s: string; rank: number }[] = [];
  game.stats.forEach((s, i) => {
    const n = game.defs[i]?.n ?? i + 1;
    const hd = s.holed;
    if (!hd) return;
    if (hd.by === "shot") {
      const ace = game.scores[i]?.strokes === 1;
      out.push({ s: ace ? `Hole in one on ${n}` : hd.yd <= 40 ? `Chip-in on ${n}` : `Holed from ${hd.yd} yd on ${n}`, rank: 1000 + hd.yd });
    } else if (hd.ft >= 25) out.push({ s: `${hd.ft} ft putt on ${n}`, rank: hd.ft });
  });
  return out
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 3)
    .map((o) => o.s);
}

/** how the round was played: fairways and greens hit, putts, the longest drive, penalty strokes */
export function roundStats(game: CourseGame) {
  const st = game.stats;
  const fw = st.filter((s) => s.fairway !== null);
  const drives = st.map((s) => s.drive).filter((d): d is number => d !== null);
  return {
    fairways: `${fw.filter((s) => s.fairway).length}/${fw.length}`,
    greens: `${st.filter((s) => s.gir).length}/${st.length}`,
    putts: st.reduce((a, s) => a + s.putts, 0),
    drive: drives.length ? Math.max(...drives) : null,
    penalties: st.reduce((a, s) => a + s.penalties, 0),
  };
}
