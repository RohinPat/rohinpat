import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterSettle, makePacer, whenIdle } from "@/components/offhours/tileSchedule";

// Drive a pacer the way a tile does: an animation frame every 1000/60 ms; a
// frame draws when `due` says so, and `cost` stands in for a slow draw.
function run(cost: (n: number) => number, ms = 6000) {
  let now = 0;
  let clock = 0;
  const pacer = makePacer();
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  let drawn = 0;
  while (now < ms) {
    now += 1000 / 60;
    clock = now;
    if (!pacer.due(now)) continue;
    pacer.draw(() => {
      clock += cost(drawn);
      now += 0; // the draw itself runs inside this frame; the next frame comes after it
    });
    now = clock;
    drawn++;
  }
  return { drawn, seconds: ms / 1000, pacer };
}

describe("makePacer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("holds a cheap tile to about 30 frames a second", () => {
    const { drawn, seconds } = run(() => 1);
    expect(drawn / seconds).toBeGreaterThan(26);
    expect(drawn / seconds).toBeLessThanOrEqual(31);
  });

  it("backs off when a frame is costly, keeping the tile under a quarter of the main thread", () => {
    const cost = 40;
    const { drawn, seconds } = run(() => cost);
    expect(drawn / seconds).toBeLessThan(8);
    expect((drawn * cost) / (seconds * 1000)).toBeLessThan(0.25);
  });

  it("never stops: even a very slow frame still draws about once a second", () => {
    const { drawn, seconds } = run(() => 600, 12000);
    expect(drawn / seconds).toBeGreaterThan(0.4);
  });

  it("recovers when frames get cheap again", () => {
    const { drawn, seconds } = run((n) => (n < 12 ? 120 : 1), 20000);
    expect(drawn / seconds).toBeGreaterThan(15);
  });

  it("does not count the first frame (shader compiles) against the tile", () => {
    const { pacer } = run((n) => (n === 0 ? 900 : 1), 1500);
    expect(pacer.cost()).toBeLessThan(5);
  });
});

describe("whenIdle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // no requestIdleCallback in happy-dom: whenIdle falls back to a timer
    vi.stubGlobal("requestIdleCallback", undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts tiles one at a time, in order, a beat apart", () => {
    const order: number[] = [];
    whenIdle(() => order.push(1));
    whenIdle(() => order.push(2));
    whenIdle(() => order.push(3));
    vi.advanceTimersByTime(50);
    expect(order).toEqual([1]);
    vi.advanceTimersByTime(200);
    expect(order).toEqual([1, 2]);
    vi.advanceTimersByTime(400);
    expect(order).toEqual([1, 2, 3]);
  });

  it("skips a tile that left before its turn", () => {
    const order: number[] = [];
    whenIdle(() => order.push(1));
    const cancel = whenIdle(() => order.push(2));
    whenIdle(() => order.push(3));
    cancel();
    vi.advanceTimersByTime(1000);
    expect(order).toEqual([1, 3]);
  });
});

describe("afterSettle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs straight away on a wide screen", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const run = vi.fn();
    afterSettle(run);
    expect(run).toHaveBeenCalledOnce();
  });

  it("waits a few seconds on a phone-sized screen, and can be cancelled", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const run = vi.fn();
    const cancel = afterSettle(run);
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4000);
    expect(run).toHaveBeenCalledOnce();
    const never = vi.fn();
    afterSettle(never)();
    vi.advanceTimersByTime(10000);
    expect(never).not.toHaveBeenCalled();
    cancel();
  });
});
