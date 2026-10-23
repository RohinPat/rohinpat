"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectPlatform, normalizeAcceleration, Platform } from "@/lib/lab/mirror/orientation";
import { BroadcastChannelTransport, MirrorMessage, Transport, epochNow } from "@/lib/lab/mirror/transport";
import css from "./mirror.module.css";

type Phase = "idle" | "connecting" | "live" | "unlocked" | "denied" | "nosensor";

const MIN_SEND_MS = 8; // cap at ~125 Hz even if a browser fires faster
const UNLOCK_FRACTION = 0.14; // of the screen height
const FLICK_SPEED = 0.9; // screens per second

/** iOS 13+ gates motion behind a prompt that must be raised from a tap. */
async function askMotionPermission(): Promise<"granted" | "denied" | "not-needed"> {
  type Gate = { requestPermission?: () => Promise<"granted" | "denied"> };
  const doe = (window as unknown as { DeviceOrientationEvent?: Gate }).DeviceOrientationEvent;
  const dme = (window as unknown as { DeviceMotionEvent?: Gate }).DeviceMotionEvent;
  try {
    if (doe && typeof doe.requestPermission === "function") {
      // one prompt covers orientation and motion on iOS
      return (await doe.requestPermission()) === "granted" ? "granted" : "denied";
    }
    if (dme && typeof dme.requestPermission === "function") {
      return (await dme.requestPermission()) === "granted" ? "granted" : "denied";
    }
  } catch {
    return "denied";
  }
  return "not-needed";
}

function screenAngle(): number {
  const a = window.screen?.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
  return ((a % 360) + 360) % 360;
}

export default function MirrorPhone({ room = "default" }: { room?: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [announce, setAnnounce] = useState("");
  const [readout, setReadout] = useState("");
  const [lockY, setLockY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [taps, setTaps] = useState<{ id: number; x: number; y: number }[]>([]);
  const tr = useRef<Transport | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const phaseRef = useRef<Phase>("idle");
  const padRef = useRef<HTMLDivElement>(null);
  const tapId = useRef(0);
  const drag = useRef<{ y0: number; t0: number; y: number; id: number; captured: boolean } | null>(null);
  const sent = useRef({ n: 0 });

  const go = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const send = useCallback((m: MirrorMessage) => {
    tr.current?.send(m);
  }, []);

  const start = useCallback(async () => {
    // permission first, inside the tap, before anything else awaits
    const perm = await askMotionPermission();
    if (perm === "denied") {
      go("denied");
      setAnnounce("Motion access was denied. Reload and allow it to continue.");
      return;
    }
    go("connecting");
    setAnnounce("Connecting to the laptop.");
    const platform: Platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
    const transport = new BroadcastChannelTransport(room);
    tr.current = transport;

    let seq = 0;
    let lastOrient = 0;
    let lastMotion = 0;
    let gotOrientation = false;
    let ready = false;
    let helloTimer = 0;
    let readoutAt = 0;

    const hello = () => {
      transport.send({
        type: "hello",
        t: epochNow(),
        platform,
        ua: navigator.userAgent.slice(0, 160),
        screen: { w: window.innerWidth, h: window.innerHeight },
      });
    };
    hello();
    helloTimer = window.setInterval(() => {
      if (!ready) hello();
    }, 1000);

    const offMsg = transport.onMessage((m) => {
      if (m.type === "ready" && !ready) {
        ready = true;
        window.clearInterval(helloTimer);
        if (phaseRef.current === "connecting") {
          go("live");
          setAnnounce("Connected. Swipe up to unlock the phone on your laptop.");
        }
      } else if (m.type === "lock") {
        setLockY(0);
        go("live");
        setAnnounce("Locked again.");
      } else if (m.type === "ping") {
        transport.send({ type: "pong", t0: m.t0, t1: epochNow() });
      } else if (m.type === "recalibrate") {
        /* nothing to do phone-side */
      }
    });

    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.alpha === null && e.beta === null && e.gamma === null) return;
      gotOrientation = true;
      const t = epochNow();
      if (t - lastOrient < MIN_SEND_MS) return;
      lastOrient = t;
      transport.send({
        type: "orient",
        t,
        seq: seq++,
        alpha: e.alpha ?? 0,
        beta: e.beta ?? 0,
        gamma: e.gamma ?? 0,
        screenAngle: screenAngle(),
      });
      sent.current.n = seq;
      if (t - readoutAt > 200) {
        readoutAt = t;
        setReadout(`a ${(e.alpha ?? 0).toFixed(0)}  b ${(e.beta ?? 0).toFixed(0)}  g ${(e.gamma ?? 0).toFixed(0)}`);
      }
    };
    const onMotion = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity;
      const r = e.rotationRate;
      if (!g || g.x === null || g.y === null || g.z === null) return;
      const t = epochNow();
      if (t - lastMotion < 16) return;
      lastMotion = t;
      const a = normalizeAcceleration({ x: g.x, y: g.y, z: g.z }, platform);
      transport.send({
        type: "motion",
        t,
        ax: a.x,
        ay: a.y,
        az: a.z,
        ra: r?.alpha ?? 0,
        rb: r?.beta ?? 0,
        rg: r?.gamma ?? 0,
      });
    };
    window.addEventListener("deviceorientation", onOrient);
    window.addEventListener("devicemotion", onMotion);

    // keep the screen awake while streaming (best effort)
    let wake: { release?: () => Promise<void> } | null = null;
    try {
      const nav = navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
      nav.wakeLock?.request("screen").then((w) => (wake = w)).catch(() => {});
    } catch {
      /* not available */
    }

    const sensorTimer = window.setTimeout(() => {
      if (!gotOrientation) {
        go("nosensor");
        setAnnounce("No motion sensor data. Is this a phone, and is motion access on?");
      }
    }, 2500);

    cleanup.current = () => {
      window.clearInterval(helloTimer);
      window.clearTimeout(sensorTimer);
      window.removeEventListener("deviceorientation", onOrient);
      window.removeEventListener("devicemotion", onMotion);
      offMsg();
      transport.close();
      tr.current = null;
      void wake?.release?.();
    };
  }, [go, room]);

  useEffect(() => () => cleanup.current(), []);

  // ---- swipe up to unlock, full screen ----
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (phaseRef.current !== "live") return;
    // no capture yet: a plain tap on a button must still click. Capture once it is a drag.
    drag.current = { y0: e.clientY, t0: performance.now(), y: e.clientY, id: e.pointerId, captured: false };
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.y = e.clientY;
    if (!d.captured) {
      if (Math.abs(e.clientY - d.y0) < 6) return;
      d.captured = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    }
    const h = window.innerHeight;
    const dy = Math.max(-h, Math.min(0, e.clientY - d.y0));
    setLockY(dy);
    send({ type: "drag", t: epochNow(), dy: dy / h });
  };
  const onUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (!d.captured) return;
    setDragging(false);
    const h = window.innerHeight;
    const dy = Math.min(0, d.y - d.y0) / h;
    const speed = Math.abs(dy) / Math.max(0.016, (performance.now() - d.t0) / 1000);
    if (dy < -UNLOCK_FRACTION || (dy < -0.04 && speed > FLICK_SPEED)) {
      setLockY(-h * 1.05);
      send({ type: "unlock", t: epochNow() });
      go("unlocked");
      setAnnounce("Unlocked. Tap anywhere to tap the phone on your laptop.");
    } else {
      setLockY(0);
      send({ type: "drag", t: epochNow(), dy: 0 });
    }
  };

  // ---- after unlock: the whole screen is a touchpad ----
  const onPadDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (phaseRef.current !== "unlocked") return;
    if ((e.target as HTMLElement).closest("button")) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    send({ type: "tap", t: epochNow(), x, y });
    const id = ++tapId.current;
    setTaps((t) => [...t.slice(-4), { id, x: e.clientX - r.left, y: e.clientY - r.top }]);
    window.setTimeout(() => setTaps((t) => t.filter((p) => p.id !== id)), 650);
  };

  const recentre = () => {
    send({ type: "recalibrate", t: epochNow() });
    setAnnounce("Re-centred.");
  };

  const lockedAgain = () => {
    setLockY(0);
    go("live");
    send({ type: "lock", t: epochNow() });
  };

  if (phase === "idle" || phase === "denied" || phase === "nosensor") {
    return (
      <section className={css.phonePage} aria-label="Phone controller">
        <div className={css.pad}>
          <div className={css.padInner}>
            <h1 className={css.big}>Pick up your phone.</h1>
            <p className={css.sub}>
              This page streams your phone&apos;s tilt to the laptop tab. Nothing leaves this device except to the other tab.
            </p>
            <button type="button" className={css.cta} onClick={start}>
              Connect motion sensors
            </button>
            <p className={css.sub} role="status" aria-live="polite" style={{ marginTop: 18 }}>
              {phase === "denied" && "Motion access was denied. Reload and allow it to continue."}
              {phase === "nosensor" && "No motion sensor data arrived. This needs a phone with a gyroscope, and motion access allowed."}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={css.phonePage} aria-label="Phone controller">
      <p className={css.srOnly} role="status" aria-live="polite">
        {announce}
      </p>

      {/* under the lock layer: a touchpad for the unlocked phone */}
      <div ref={padRef} className={css.pad} onPointerDown={onPadDown} data-testid="pad" data-phase={phase} style={{ touchAction: "none" }}>
        <div className={css.padInner}>
          <h1 className={css.big}>Unlocked.</h1>
          <p className={css.sub}>Tap anywhere. It lands on the phone on your laptop.</p>
          <p className={css.readout} style={{ marginTop: 18 }}>
            {readout}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 18 }}>
            <button type="button" className={css.ghost} onClick={recentre}>
              Re-centre
            </button>
            <button type="button" className={css.ghost} onClick={lockedAgain}>
              Lock again
            </button>
          </div>
        </div>
        {taps.map((t) => (
          <span key={t.id} className={css.tapDot} style={{ left: t.x, top: t.y }} />
        ))}
      </div>

      {/* the lock layer: follows the finger, like the site's */}
      <div
        className={css.phoneLock}
        data-testid="phone-lock"
        style={{
          transform: `translateY(${lockY}px)`,
          transition: dragging ? "none" : "transform 0.48s cubic-bezier(0.32,0.72,0,1)",
          pointerEvents: phase === "unlocked" ? "none" : "auto",
          touchAction: "none",
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div>
          <p className={css.readout} data-testid="readout">
            {phase === "connecting" ? "connecting…" : readout}
          </p>
        </div>
        <div>
          <h1 className={css.big}>{phase === "connecting" ? "Looking for your laptop" : "Tilt me."}</h1>
          <p className={css.sub}>{phase === "connecting" ? "Open the lab page in the other tab." : "Your laptop's phone is following."}</p>
        </div>
        <div>
          <svg className={css.chev} width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 15l6-6 6 6" />
          </svg>
          <p className={css.sub} style={{ fontWeight: 600 }}>
            Swipe up to unlock
          </p>
          <div style={{ marginTop: 14 }}>
            <button type="button" className={css.ghost} onClick={recentre}>
              Re-centre
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
