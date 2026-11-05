import { afterEach, describe, expect, it, vi } from "vitest";
import { Session, type Res } from "@/components/offhours/learn/session";
import { localLink, openLink } from "@/components/offhours/learn/link";
import { CAP_SHARE, START_S } from "@/components/offhours/learn/run";
import { getTarget } from "@/components/offhours/night/target";

type Gen = Extract<Res, { type: "gen" }>;
type Best = Extract<Res, { type: "best" }>;

/** a session that collects what it says, worked to the end */
function drive(reqs: Parameters<Session["request"]>[0][]) {
  const s = new Session();
  const out: Res[] = [];
  s.post = (r) => out.push(r);
  for (const r of reqs) s.request(r);
  while (s.work(1000));
  return { s, out };
}
const gens = (out: Res[]) => out.filter((r): r is Gen => r.type === "gen");

describe("the session's messages", () => {
  it("start: says what road it will drive and how big the population is", () => {
    const { out } = drive([{ type: "start", seed: 3 }]);
    expect(out).toHaveLength(1);
    const r = out[0];
    expect(r.type).toBe("ready");
    if (r.type !== "ready") return;
    expect(r.pop).toBe(24);
    expect(r.seed).toBe(3);
    expect(r.targetS).toBeCloseTo(getTarget().ghost.time, 9);
    expect(r.capS).toBeCloseTo(r.targetS * CAP_SHARE, 9);
    expect(r.length).toBe(3680);
  });

  it("step: one gen message per generation, numbered, and only the last of a traced step carries the cars", { timeout: 60_000 }, () => {
    const { out } = drive([{ type: "start", seed: 1 }, { type: "step", gens: 3, trace: true }]);
    const g = gens(out);
    expect(g.map((x) => x.stat.gen)).toEqual([1, 2, 3]);
    expect(g[0].cars).toBeUndefined();
    expect(g[1].cars).toBeUndefined();
    const cars = g[2].cars;
    expect(cars).toHaveLength(24);
    // best first: the first car got at least as far as the rest
    expect(cars?.[0].dist).toBeGreaterThanOrEqual(Math.max(...(cars ?? []).map((c) => c.dist)) - 1e-6);
    for (const c of cars ?? []) {
      expect(c.n).toBeGreaterThan(0);
      expect(c.data.length).toBe(c.n * 7);
    }
    // in the first generation every car is new; in later ones the elite (three) are carried over
    const g1 = drive([{ type: "start", seed: 1 }, { type: "step", gens: 1, trace: true }]).out;
    expect(gens(g1)[0].fresh).toEqual(Array(24).fill(true));
    expect(g[2].fresh).toHaveLength(24);
    expect(g[2].fresh?.filter((f) => !f)).toHaveLength(3);
    expect(g[0].improved).toBe(true);
    expect(g[2].reasons).toHaveLength(24);
    // the numbers are what the generation did
    expect(g[2].stat.best).toBeGreaterThanOrEqual(g[0].stat.best);
    expect(g[2].champion.gen).toBeGreaterThanOrEqual(1);
  });

  it("best: the best car so far, driven again, matches what the generations said of it", { timeout: 60_000 }, () => {
    const { out } = drive([{ type: "start", seed: 2 }, { type: "step", gens: 4 }, { type: "best" }]);
    const b = out[out.length - 1] as Best;
    expect(b.type).toBe("best");
    expect(b.ghost).not.toBeNull();
    const last = gens(out)[3];
    expect(b.champion).toEqual(last.champion);
    const gh = b.ghost;
    if (!gh) return;
    expect(gh.time).toBeCloseTo(last.champion.time, 6);
    // the ghost is sampled twenty times a second: its last sample is within a step or two of the end
    expect(Math.abs(gh.dist - START_S - last.champion.dist)).toBeLessThan(4);
  });

  it("best before anything has been driven is nothing", () => {
    const { out } = drive([{ type: "start", seed: 2 }, { type: "best" }]);
    expect(out[1]).toEqual({ type: "best", ghost: null, champion: null });
  });

  it("stop: drops what was queued and the session; a later start begins again", { timeout: 60_000 }, () => {
    const s = new Session();
    const out: Res[] = [];
    s.post = (r) => out.push(r);
    s.request({ type: "start", seed: 5 });
    s.request({ type: "step", gens: 50 });
    // a little work, then stop mid-way
    s.work(20);
    const some = gens(out).length;
    expect(some).toBeLessThan(50);
    s.request({ type: "stop" });
    expect(out[out.length - 1]).toEqual({ type: "stopped" });
    expect(s.busy).toBe(false);
    expect(s.work(1000)).toBe(false);
    s.request({ type: "step", gens: 2 });
    expect(s.work(1000)).toBe(false);
    expect(gens(out)).toHaveLength(some);
    // a new start counts generations from one again
    s.request({ type: "start", seed: 5 });
    s.request({ type: "step", gens: 1 });
    while (s.work(1000));
    expect(gens(out).pop()?.stat.gen).toBe(1);
  });

  it("works in slices: a small budget gets part of the way and says there is more", { timeout: 60_000 }, () => {
    const s = new Session();
    const out: Res[] = [];
    s.post = (r) => out.push(r);
    s.request({ type: "start", seed: 1 });
    s.request({ type: "step", gens: 5 });
    let slices = 0;
    while (s.work(0)) slices++;
    expect(slices).toBeGreaterThan(5);
    expect(gens(out)).toHaveLength(5);
  });

  it("ignores messages before a start", () => {
    const s = new Session();
    const out: Res[] = [];
    s.post = (r) => out.push(r);
    s.request({ type: "step", gens: 3 });
    s.request({ type: "best" });
    expect(s.work(1000)).toBe(false);
    expect(out).toEqual([]);
  });

  it("is the same for the same seed", { timeout: 60_000 }, () => {
    const run = () => gens(drive([{ type: "start", seed: 9 }, { type: "step", gens: 4 }]).out).map((g) => g.stat);
    expect(run()).toEqual(run());
    const other = gens(drive([{ type: "start", seed: 10 }, { type: "step", gens: 4 }]).out).map((g) => g.stat);
    expect(other).not.toEqual(run());
  });
});

describe("the link", () => {
  it("the local link works the session a slice at a time, as a worker would", { timeout: 60_000 }, () => {
    const link = localLink();
    expect(link.kind).toBe("local");
    const got: Res[] = [];
    link.onmessage = (r) => got.push(r);
    link.post({ type: "start", seed: 4 });
    link.post({ type: "step", gens: 2, trace: true });
    let frames = 0;
    while (gens(got).length < 2 && frames < 100_000) {
      link.pump(5);
      frames++;
    }
    expect(got[0].type).toBe("ready");
    expect(gens(got)).toHaveLength(2);
    expect(gens(got)[1].cars).toHaveLength(24);
    link.close();
    expect(got[got.length - 1]).toEqual({ type: "stopped" });
  });

  it("falls back to the local link where there is no worker", () => {
    const link = openLink();
    expect(link.kind).toBe("local");
    link.close();
    expect(openLink(true).kind).toBe("local");
  });
});

describe("the worker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("answers the same messages through postMessage", { timeout: 60_000 }, async () => {
    vi.resetModules();
    const sent: { res: Res; transfer?: Transferable[] }[] = [];
    vi.spyOn(self, "postMessage").mockImplementation(((res: Res, transfer?: Transferable[]) => {
      sent.push({ res, transfer });
    }) as unknown as typeof self.postMessage);
    await import("@/components/offhours/learn/learn.worker");
    const send = (data: unknown) => (self as unknown as { onmessage: (e: { data: unknown }) => void }).onmessage({ data });
    const until = async (done: () => boolean) => {
      for (let i = 0; i < 2000 && !done(); i++) await new Promise((r) => setTimeout(r, 5));
      expect(done()).toBe(true);
    };

    send({ type: "start", seed: 1 });
    expect(sent[0].res.type).toBe("ready");
    send({ type: "step", gens: 2, trace: true });
    await until(() => sent.filter((m) => m.res.type === "gen").length === 2);
    const last = sent.filter((m) => m.res.type === "gen")[1];
    expect((last.res as Gen).cars).toHaveLength(24);
    // the cars' data is handed over, not copied
    expect(last.transfer).toHaveLength(24);
    send({ type: "best" });
    await until(() => sent.some((m) => m.res.type === "best"));
    send({ type: "stop" });
    await until(() => sent.some((m) => m.res.type === "stopped"));
  });
});
