"use client";

import { useEffect, useRef, useState } from "react";
import { mockRequested } from "@/lib/link/useLink";
import { createAccelSignDetector, flipAccel, motionSampleFromEvent } from "@/lib/motion";
import type { DeviceMotionLike, MotionSample, OrientationAngles } from "@/lib/motion";

const NO_DATA_MS = 2500;

/**
 * Stream motion samples (SI units, accelerometer sign normalised to the spec)
 * to `onSample` while `enabled`. Run only the active game's recogniser: a
 * controller turns this on when it mounts and the listeners go away with it.
 *
 * `receiving` is null until we know, true after the first usable sample, false
 * if none arrived in a couple of seconds (no sensor, or motion blocked): the
 * controller should then offer its touch fallback.
 */
export function useMotionSamples(enabled: boolean, onSample: (s: MotionSample) => void): { receiving: boolean | null } {
  const latest = useRef(onSample);
  latest.current = onSample;
  const [receiving, setReceiving] = useState<boolean | null>(null);

  useEffect(() => {
    if (!enabled) {
      setReceiving(null);
      return;
    }
    let orient: OrientationAngles | null = null;
    let got = false;
    const sign = createAccelSignDetector();
    let flip = false;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.alpha === null && e.beta === null && e.gamma === null) return;
      orient = { alpha: e.alpha ?? 0, beta: e.beta ?? 0, gamma: e.gamma ?? 0 };
    };
    const onMotion = (e: DeviceMotionEvent) => {
      const s = motionSampleFromEvent(e as unknown as DeviceMotionLike, performance.now() / 1000, orient);
      if (!s) return;
      if (!got) {
        got = true;
        setReceiving(true);
      }
      sign.add(s);
      const sg = sign.sign();
      if (sg !== null) flip = sg === -1;
      latest.current(flip ? flipAccel(s) : s);
    };
    window.addEventListener("deviceorientation", onOrient);
    window.addEventListener("devicemotion", onMotion);
    // with the mock link (tests, local work) a page can feed samples in directly
    const w = window as unknown as { __linkMotion?: { push: (s: MotionSample) => void } };
    if (mockRequested()) w.__linkMotion = { push: (s) => latest.current(s) };
    const timer = window.setTimeout(() => {
      if (!got) setReceiving(false);
    }, NO_DATA_MS);
    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      window.removeEventListener("devicemotion", onMotion);
      delete w.__linkMotion;
      window.clearTimeout(timer);
    };
  }, [enabled]);

  return { receiving };
}
