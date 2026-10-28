import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buzz, canVibrate, pulses, strength } from "@/lib/haptics";

const nav = navigator as unknown as { vibrate?: unknown };

function reduced(on: boolean) {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}

let clock = 1_000_000;

describe("haptics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // the module remembers when it last flashed; each test starts a minute later
    clock += 60_000;
    vi.setSystemTime(new Date(clock));
    reduced(false);
  });
  afterEach(() => {
    delete nav.vibrate;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("reads a pattern as buzzes and gaps", () => {
    expect(pulses(25)).toEqual([{ at: 0, ms: 25 }]);
    expect(pulses([40, 70, 40])).toEqual([
      { at: 0, ms: 40 },
      { at: 110, ms: 40 },
    ]);
    expect(pulses(0)).toEqual([]);
    expect(pulses([NaN, 10, -5])).toEqual([]);
  });

  it("scales strength with the time the motor would run", () => {
    expect(strength(6)).toBeCloseTo(0.1);
    expect(strength(30)).toBeCloseTo(0.5);
    expect(strength([40, 70, 40])).toBe(1);
    expect(strength(90)).toBe(1);
    expect(strength(30)).toBeGreaterThan(strength(12));
  });

  it("vibrates where it can, and draws nothing", () => {
    const v = vi.fn(() => true);
    nav.vibrate = v;
    expect(canVibrate()).toBe(true);
    expect(buzz([40, 70, 40])).toBe("vibrate");
    expect(v).toHaveBeenCalledWith([40, 70, 40]);
    expect(document.querySelector('[data-testid="buzz-flash"]')).toBeNull();
  });

  it("flashes the screen when the browser cannot vibrate", () => {
    expect(canVibrate()).toBe(false);
    expect(buzz(35)).toBe("flash");
    const el = document.querySelector<HTMLElement>('[data-testid="buzz-flash"]')!;
    expect(el).not.toBeNull();
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.style.pointerEvents).toBe("none");
    expect(el.dataset.reduced).toBe("false");
    expect(el.style.boxShadow).toContain("inset");
    vi.advanceTimersByTime(1000);
    expect(document.querySelector('[data-testid="buzz-flash"]')).toBeNull();
  });

  it("flashes when vibrate throws", () => {
    nav.vibrate = () => {
      throw new Error("blocked");
    };
    expect(buzz(30)).toBe("flash");
  });

  it("makes a stronger buzz a stronger light", () => {
    buzz(12);
    const weak = document.querySelector<HTMLElement>('[data-testid="buzz-flash"]')!;
    const w = weak.style.boxShadow;
    vi.advanceTimersByTime(1000);
    buzz(90);
    const strong = document.querySelector<HTMLElement>('[data-testid="buzz-flash"]')!;
    expect(Number(strong.dataset.strength)).toBeGreaterThan(Number(weak.dataset.strength));
    expect(strong.style.boxShadow).not.toBe(w);
  });

  it("uses a faint tint, no glow, under reduced motion", () => {
    reduced(true);
    expect(buzz(90)).toBe("flash");
    const el = document.querySelector<HTMLElement>('[data-testid="buzz-flash"]')!;
    expect(el.dataset.reduced).toBe("true");
    expect(el.style.boxShadow).toBe("");
    expect(Number(el.style.opacity)).toBeLessThanOrEqual(0.15);
  });

  it("does not strobe on a run of ticks, but a hard buzz always shows", () => {
    buzz(6);
    buzz(6);
    expect(document.querySelectorAll('[data-testid="buzz-flash"]')).toHaveLength(1);
    buzz(90);
    expect(document.querySelectorAll('[data-testid="buzz-flash"]')).toHaveLength(2);
  });

  it("ignores an empty pattern", () => {
    expect(buzz(0)).toBe("none");
    expect(buzz([])).toBe("none");
  });
});
