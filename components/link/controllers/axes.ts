import type { LinkMsg } from "@/lib/link/session";

// The phone end of a continuous control: a few named axes, sent to the laptop
// only when one changes, and no more often than every `intervalMs` (so a 60-120 Hz
// motion stream becomes ~30 messages a second, not 120). Values are snapped to
// `step` (so sensor noise inside a step sends nothing), a value inside
// `snapZero` of 0 is sent as 0, and the last value always gets out: a change
// that lands inside the interval goes out when the interval is up.
//
// The laptop smooths what it receives (components/offhours/remoteAxis.ts).

export interface AxesOptions {
  /** the least time between two sends, ms (33 = 30 Hz) */
  intervalMs?: number;
  /** values are rounded to a multiple of this */
  step?: number;
  /** |v| below this goes out as exactly 0 */
  snapZero?: number;
  /** a clock and timers, for tests */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export interface Axes {
  /** set one axis; it goes out now or when the interval is up, if it changed */
  set(name: string, v: number): void;
  /** send everything that has changed right now */
  flush(): void;
  /** send every axis as 0 right now (leaving, backgrounded, switching mode) */
  zero(): void;
  /** what the laptop was last told */
  sent(name: string): number;
  /** stop the timer; send zeros first if you want the laptop at rest */
  dispose(): void;
}

export function createAxes(send: (m: LinkMsg) => void, names: readonly string[], options: AxesOptions = {}): Axes {
  const interval = options.intervalMs ?? 33;
  const step = options.step ?? 0.02;
  const snapZero = options.snapZero ?? 0.015;
  const now = options.now ?? (() => performance.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const want: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]));
  const sent: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]));
  let lastSend = -Infinity;
  let timer: unknown = null;

  const emit = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    let any = false;
    for (const n of names) {
      if (sent[n] === want[n]) continue;
      sent[n] = want[n];
      send({ type: "axis", name: n, v: want[n] });
      any = true;
    }
    if (any) lastSend = now();
  };

  const dirty = () => {
    return names.some((n) => sent[n] !== want[n]);
  };

  return {
    set(name, v) {
      if (!(name in want) || !Number.isFinite(v)) return;
      const q = Math.abs(v) < snapZero ? 0 : Math.round(v / step) * step;
      want[name] = Math.round(q * 1000) / 1000 || 0;
      if (!dirty()) return;
      const wait = interval - (now() - lastSend);
      if (wait <= 0) emit();
      else if (timer === null) timer = setTimer(emit, wait);
    },
    flush: emit,
    zero() {
      for (const n of names) want[n] = 0;
      emit();
    },
    sent: (name) => sent[name] ?? 0,
    dispose() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
