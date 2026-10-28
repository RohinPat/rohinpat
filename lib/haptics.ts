// One buzzer for the phone's controllers. Where the browser can vibrate
// (Android Chrome) it does. Safari on iPhone has no navigator.vibrate, so
// there the same call becomes a light on the screen instead: an edge glow,
// brighter and a bit wider the stronger the pattern, one pulse per buzz.
// With prefers-reduced-motion it is a faint tint that fades, nothing else.
// Nothing here is stored or sent anywhere.

export type Pattern = number | number[];
export type Pulse = { at: number; ms: number };

const MAX_MS = 600;
const MIN_GAP = 90;
let lastFlash = 0;

/** The buzzes in a vibration pattern: on, off, on, off... in milliseconds. */
export function pulses(pattern: Pattern): Pulse[] {
  const list = Array.isArray(pattern) ? pattern : [pattern];
  const out: Pulse[] = [];
  let at = 0;
  list.forEach((n, i) => {
    const ms = Number.isFinite(n) ? Math.max(0, n) : 0;
    if (i % 2 === 0 && ms > 0 && at < MAX_MS) out.push({ at, ms });
    at += ms;
  });
  return out;
}

/** 0..1: how hard the pattern hits. 6 ms is a tick (0.1); 60 ms or more is full. */
export function strength(pattern: Pattern): number {
  const on = pulses(pattern).reduce((t, p) => t + p.ms, 0);
  return Math.min(1, Math.max(0.1, on / 60));
}

export function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function flash(pattern: Pattern) {
  if (typeof document === "undefined") return;
  const now = Date.now();
  const s = strength(pattern);
  // a flurry of ticks (keys, a ratcheting crown) must not strobe
  if (now - lastFlash < MIN_GAP && s < 0.5) return;
  lastFlash = now;
  const list = pulses(pattern);
  if (!list.length) return;
  const reduce = reducedMotion();

  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.dataset.testid = "buzz-flash";
  el.setAttribute("data-testid", "buzz-flash");
  el.dataset.strength = s.toFixed(2);
  el.dataset.reduced = String(reduce);
  const st = el.style;
  st.position = "fixed";
  st.inset = "0";
  st.pointerEvents = "none";
  st.zIndex = "2147483000";
  st.opacity = "0";
  if (reduce) {
    st.background = "#8ad9a8";
  } else {
    const w = Math.round(10 + s * 38);
    st.boxShadow = `inset 0 0 ${w * 1.6}px ${w}px rgba(138, 217, 168, ${(0.3 + s * 0.5).toFixed(2)})`;
  }
  document.body.appendChild(el);

  const peak = reduce ? 0.04 + s * 0.1 : 1;
  const fade = reduce ? 260 : 150;
  const total = list[list.length - 1].at + list[list.length - 1].ms + fade;
  const frames: Keyframe[] = [{ offset: 0, opacity: 0 }];
  for (const p of list) {
    frames.push({ offset: p.at / total, opacity: 0 });
    frames.push({ offset: (p.at + Math.min(p.ms, 60)) / total, opacity: peak });
  }
  frames.push({ offset: 1, opacity: 0 });
  // keep offsets non-decreasing when pulses sit closer than the ramp
  for (let i = 1; i < frames.length; i++) frames[i].offset = Math.max(frames[i].offset as number, frames[i - 1].offset as number);

  const done = () => el.remove();
  if (typeof el.animate === "function") {
    const a = el.animate(frames, { duration: total, easing: "ease-out" });
    a.onfinish = done;
    a.oncancel = done;
  } else {
    st.opacity = String(peak);
    window.setTimeout(done, total);
  }
}

/**
 * Buzz the phone. Returns how it was done: "vibrate", "flash" (no vibration
 * motor in this browser, so the screen pulses), or "none" for an empty pattern.
 */
export function buzz(pattern: Pattern): "vibrate" | "flash" | "none" {
  if (!pulses(pattern).length) return "none";
  if (canVibrate()) {
    try {
      navigator.vibrate(pattern);
      return "vibrate";
    } catch {
      /* fall through to the light */
    }
  }
  try {
    flash(pattern);
    return "flash";
  } catch {
    return "none";
  }
}
