"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createAccelSignDetector,
  flipAccel,
  motionSampleFromEvent,
} from "@/lib/motion";
import type { DeviceMotionLike, MotionSample, OrientationAngles } from "@/lib/motion";

export type StreamStatus = "idle" | "requesting" | "listening" | "denied" | "unsupported" | "no-data";

export interface StreamSample {
  /** As the browser reported it (what gets recorded). */
  raw: MotionSample;
  /** With the accelerometer sign normalised to the spec (what the recognisers see). */
  fixed: MotionSample;
}

export interface MotionStream {
  status: StreamStatus;
  message: string;
  rateHz: number;
  /** 1 = browser follows the spec, -1 = inverted and corrected, null = not known yet. */
  accelSign: 1 | -1 | null;
  /** Must be called from a click or tap (iOS requires it for the permission prompt). */
  enable: () => void;
  subscribe: (fn: (s: StreamSample) => void) => () => void;
  /** Ring buffer of the last few seconds, for drawing. Mutated in place. */
  buffer: React.MutableRefObject<MotionSample[]>;
}

const BUFFER_S = 6;

interface PermissionedEvent {
  requestPermission?: () => Promise<"granted" | "denied">;
}

export function useMotionStream(): MotionStream {
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [message, setMessage] = useState("Motion sensors are off. Tap the button to turn them on.");
  const [rateHz, setRateHz] = useState(0);
  const [accelSign, setAccelSign] = useState<1 | -1 | null>(null);
  const subs = useRef(new Set<(s: StreamSample) => void>());
  const buffer = useRef<MotionSample[]>([]);
  const orient = useRef<OrientationAngles | null>(null);
  const count = useRef(0);
  const signRef = useRef<1 | -1 | null>(null);
  const signDet = useRef(createAccelSignDetector());
  const listening = useRef(false);
  const handlers = useRef<{ motion: (e: DeviceMotionEvent) => void; orient: (e: DeviceOrientationEvent) => void } | null>(null);

  const subscribe = useCallback((fn: (s: StreamSample) => void) => {
    subs.current.add(fn);
    return () => {
      subs.current.delete(fn);
    };
  }, []);

  const attach = useCallback(() => {
    if (listening.current) return;
    listening.current = true;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.alpha === null && e.beta === null && e.gamma === null) return;
      orient.current = { alpha: e.alpha ?? 0, beta: e.beta ?? 0, gamma: e.gamma ?? 0 };
    };
    const onMotion = (e: DeviceMotionEvent) => {
      const t = performance.now() / 1000;
      const raw = motionSampleFromEvent(e as unknown as DeviceMotionLike, t, orient.current);
      if (!raw) return;
      count.current++;
      signDet.current.add(raw);
      const sg = signDet.current.sign();
      if (sg !== signRef.current) {
        signRef.current = sg;
        setAccelSign(sg);
      }
      const fixed = signRef.current === -1 ? flipAccel(raw) : raw;
      const buf = buffer.current;
      buf.push(fixed);
      while (buf.length > 2 && t - buf[0].t > BUFFER_S) buf.shift();
      subs.current.forEach((fn) => fn({ raw, fixed }));
    };
    handlers.current = { motion: onMotion, orient: onOrient };
    window.addEventListener("devicemotion", onMotion);
    window.addEventListener("deviceorientation", onOrient);
  }, []);

  // Sample-rate estimate and the "nothing is arriving" diagnosis.
  useEffect(() => {
    if (status !== "listening" && status !== "no-data") return;
    let last = count.current;
    let lastT = performance.now();
    const started = lastT;
    const id = window.setInterval(() => {
      const now = performance.now();
      const n = count.current;
      const hz = ((n - last) * 1000) / (now - lastT);
      last = n;
      lastT = now;
      setRateHz(Math.round(hz));
      if (n === 0 && now - started > 2000) {
        setStatus("no-data");
        setMessage(
          window.isSecureContext
            ? "Permission is granted but no motion data is arriving. Desktop browsers have no motion sensors; open this page on a phone."
            : "No motion data, and this page is not on HTTPS. Phones only give motion data to secure (https) pages."
        );
      } else if (n > 0) {
        setStatus("listening");
        setMessage(`Receiving motion data at about ${Math.round(hz)} Hz.`);
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [status]);

  useEffect(() => {
    return () => {
      const h = handlers.current;
      if (h) {
        window.removeEventListener("devicemotion", h.motion);
        window.removeEventListener("deviceorientation", h.orient);
      }
      listening.current = false;
    };
  }, []);

  const enable = useCallback(() => {
    if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) {
      setStatus("unsupported");
      setMessage("This browser has no DeviceMotion support.");
      return;
    }
    setStatus("requesting");
    setMessage("Asking for motion permission…");
    const DM = window.DeviceMotionEvent as unknown as PermissionedEvent;
    const DO = (window as unknown as { DeviceOrientationEvent?: PermissionedEvent }).DeviceOrientationEvent;
    // iOS: requestPermission must be called inside this tap, for both event types.
    const pending: Promise<string>[] = [];
    if (typeof DM.requestPermission === "function") pending.push(DM.requestPermission());
    if (DO && typeof DO.requestPermission === "function") pending.push(DO.requestPermission());
    if (pending.length === 0) {
      attach();
      setStatus("listening");
      setMessage("Listening for motion events…");
      return;
    }
    Promise.all(pending)
      .then((results) => {
        if (results.every((r) => r === "granted")) {
          attach();
          setStatus("listening");
          setMessage("Listening for motion events…");
        } else {
          setStatus("denied");
          setMessage("Motion permission was refused. On iOS: Settings, Safari, Motion & Orientation Access; then reload.");
        }
      })
      .catch(() => {
        setStatus("denied");
        setMessage("Could not ask for motion permission. This page needs HTTPS and a tap.");
      });
  }, [attach]);

  return { status, message, rateHz, accelSign, enable, subscribe, buffer };
}
