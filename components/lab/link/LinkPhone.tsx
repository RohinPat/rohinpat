"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QrCanvas from "@/components/lab/handshake/QrCanvas";
import Portal from "@/components/lab/mirror/Portal";
import mirror from "@/components/lab/mirror/mirror.module.css";
import { HandshakePeer } from "@/lib/lab/handshake/peer";
import { ANSWER_PREFIX, answerQr, parseFragment, type QrMatrix } from "@/lib/lab/handshake/qr";
import { detectPlatform, type Platform } from "@/lib/lab/mirror/orientation";
import { epochNow } from "@/lib/lab/mirror/transport";
import {
  createAccelSignDetector,
  createFlickDetector,
  createGolfDetector,
  flipAccel,
  motionSampleFromEvent,
} from "@/lib/motion";
import type { DetectorOutput, DeviceMotionLike, FlickEvent, GolfSwingEvent, MotionSample, OrientationAngles } from "@/lib/motion";
import { LinkDiagnostics, fmtMs, type LinkSnapshot } from "@/lib/lab/link/diagnostics";
import { askMotionPermission, hasMotionApi, type MotionPermission } from "@/lib/lab/link/permission";
import { describeGesture, type LinkExtra, type PhoneMode, type Recogniser } from "@/lib/lab/link/protocol";
import { HandshakeTransport } from "@/lib/lab/link/transport";
import { CopyResults, DiagList } from "./DiagPanel";
import css from "./link.module.css";

type Phase = "init" | "unsupported" | "no-offer" | "building" | "ready" | "asking" | "denied" | "showing" | "failed" | "connected";
type Ctl = "live" | "unlocked";

const MIN_SEND_MS = 8; // cap at ~125 Hz even if a browser fires faster
const UNLOCK_FRACTION = 0.14; // of the screen height
const FLICK_SPEED = 0.9; // screens per second
const FAIL_TEXT =
  "Couldn't connect directly. Are both devices on the same Wi-Fi? Guest, hotel and campus networks often block this.";

type SwingEvt = GolfSwingEvent | FlickEvent;

function screenAngle(): number {
  const a = window.screen?.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
  return ((a % 360) + 360) % 360;
}

export default function LinkPhone() {
  return (
    <Portal>
      <LinkPhoneInner />
    </Portal>
  );
}

function LinkPhoneInner() {
  const [phase, setPhase] = useState<Phase>("init");
  const [qr, setQr] = useState<QrMatrix | null>(null);
  const [qrWidth, setQrWidth] = useState(320);
  const [answerText, setAnswerText] = useState("");
  const [perm, setPerm] = useState<MotionPermission | "unknown">("unknown");
  const [stillWaiting, setStillWaiting] = useState(false);
  const [snap, setSnap] = useState<LinkSnapshot | null>(null);
  const [linked, setLinked] = useState(false);
  const [lost, setLost] = useState(false);
  const [noSensor, setNoSensor] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [ctl, setCtl] = useState<Ctl>("live");
  const [mode, setModeState] = useState<PhoneMode>("touchpad");
  const [recogniser, setRecogniserState] = useState<Recogniser>("golf");
  const [swingLast, setSwingLast] = useState("");
  const [swingCounts, setSwingCounts] = useState({ sent: 0, ignored: 0, lastIgnored: "" });
  const [sheet, setSheet] = useState(false);
  const [readout, setReadout] = useState("");
  const [lockY, setLockY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [taps, setTaps] = useState<{ id: number; x: number; y: number }[]>([]);

  const peerRef = useRef<HandshakePeer | null>(null);
  const diagRef = useRef<LinkDiagnostics | null>(null);
  const trRef = useRef<HandshakeTransport | null>(null);
  const permRef = useRef<MotionPermission | "unknown">("unknown");
  const phaseRef = useRef<Phase>("init");
  const ctlRef = useRef<Ctl>("live");
  const modeRef = useRef<{ mode: PhoneMode; recogniser: Recogniser }>({ mode: "touchpad", recogniser: "golf" });
  const detectorRef = useRef<{ push: (s: MotionSample) => DetectorOutput<SwingEvt>[]; reset: () => void } | null>(null);
  const sentLines = useRef<{ at: string; line: string; gesture: string }[]>([]);
  const swingCountsRef = useRef({ sent: 0, ignored: 0, lastIgnored: "" });
  const lastRejectAt = useRef(0);
  const helloRef = useRef<{ ua: string; platform: string; screen: { w: number; h: number } } | null>(null);
  const handlers = useRef<{ pushSample: (s: MotionSample) => void }>({ pushSample: () => {} });
  const cleanup = useRef<() => void>(() => {});
  const wakeRef = useRef<{ release?: () => Promise<void> } | null>(null);
  const tapId = useRef(0);
  const drag = useRef<{ y0: number; t0: number; y: number; captured: boolean } | null>(null);

  const go = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const send = useCallback((m: Parameters<HandshakeTransport["send"]>[0]) => {
    trRef.current?.send(m);
  }, []);
  const sendExtra = useCallback((m: LinkExtra) => {
    trRef.current?.sendExtra(m);
  }, []);

  // ---- recognisers: ONE at a time, picked on the phone ----
  const applyMode = useCallback(
    (m: PhoneMode, r: Recogniser) => {
      modeRef.current = { mode: m, recogniser: r };
      setModeState(m);
      setRecogniserState(r);
      detectorRef.current = m === "swing" ? (r === "golf" ? createGolfDetector() : createFlickDetector()) : null;
      swingCountsRef.current = { sent: 0, ignored: 0, lastIgnored: "" };
      setSwingCounts(swingCountsRef.current);
      setSwingLast("");
      const dia = diagRef.current;
      if (dia) dia.extra.mode = m === "swing" ? `swing (${r})` : "touchpad";
      sendExtra({ type: "mode", t: epochNow(), mode: m, recogniser: m === "swing" ? r : null });
    },
    [sendExtra],
  );

  const handleOutputs = useCallback(
    (outs: DetectorOutput<SwingEvt>[]) => {
      const r = modeRef.current.recogniser;
      for (const o of outs) {
        if (o.kind === "event") {
          const e = o.event;
          const msg: LinkExtra =
            e.type === "golf-swing" ? { type: "gesture", t: epochNow(), gesture: "golf", event: e } : { type: "gesture", t: epochNow(), gesture: "flick", event: e };
          sendExtra(msg);
          const line = describeGesture(msg).line;
          sentLines.current = [...sentLines.current.slice(-19), { at: new Date().toISOString(), line, gesture: msg.gesture }];
          swingCountsRef.current = { ...swingCountsRef.current, sent: swingCountsRef.current.sent + 1 };
          setSwingCounts(swingCountsRef.current);
          setSwingLast(line);
          setAnnounce(line);
        } else {
          const now = performance.now();
          const why = `${o.reason}${o.detail ? ` (${o.detail})` : ""}`;
          swingCountsRef.current = { ...swingCountsRef.current, ignored: swingCountsRef.current.ignored + 1, lastIgnored: `${o.gesture}: ${why}` };
          setSwingCounts(swingCountsRef.current);
          if (now - lastRejectAt.current > 300) {
            lastRejectAt.current = now;
            sendExtra({ type: "gesture-reject", t: epochNow(), gesture: o.gesture || r, reason: o.reason, detail: o.detail });
          }
        }
      }
    },
    [sendExtra],
  );

  // ---- pairing: build the answer as soon as the page opens, reveal it on the click ----
  useEffect(() => {
    if (typeof RTCPeerConnection === "undefined") {
      go("unsupported");
      return;
    }
    const frag = parseFragment(window.location.hash);
    if (!frag.o) {
      go("no-offer");
      return;
    }
    let cancelled = false;
    const peer = new HandshakePeer([]);
    const diag = new LinkDiagnostics("phone");
    const tr = new HandshakeTransport(peer);
    peerRef.current = peer;
    diagRef.current = diag;
    trRef.current = tr;
    diag.extra.platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
    setQrWidth(Math.min(560, Math.max(240, window.innerWidth - 32)));
    go("building");

    let helloTimer = 0;
    let ready = false;
    const platform: Platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);

    const offMsg = tr.onMessage((m) => {
      if (m.type === "ready" && !ready) {
        ready = true;
        window.clearInterval(helloTimer);
        setLinked(true);
        setAnnounce("Connected. Swipe up to unlock the phone on your laptop.");
      } else if (m.type === "lock") {
        setLockY(0);
        ctlRef.current = "live";
        setCtl("live");
        setAnnounce("Locked again.");
      } else if (m.type === "ping") {
        tr.send({ type: "pong", t0: m.t0, t1: epochNow() });
      }
    });

    const onConnected = () => {
      if (cancelled || phaseRef.current === "connected") return;
      diag.marks.open = performance.now();
      diag.attach(peer);
      go("connected");
      setQr(null);
      const hello = {
        ua: navigator.userAgent.slice(0, 200),
        platform,
        screen: { w: window.innerWidth, h: window.innerHeight },
      };
      helloRef.current = hello;
      const sayHello = () => tr.send({ type: "hello", t: epochNow(), ...hello });
      sayHello();
      helloTimer = window.setInterval(() => {
        if (!ready) sayHello();
      }, 1000);

      // sensors
      let seq = 0;
      let lastOrient = 0;
      let readoutAt = 0;
      let gotOrientation = false;
      let orient: OrientationAngles | null = null;
      const sign = createAccelSignDetector();
      let signValue: 1 | -1 | null = null;
      const feed = (raw: MotionSample) => {
        sign.add(raw);
        const sg = sign.sign();
        if (sg !== signValue) {
          signValue = sg;
          diag.extra.accelSign = sg === null ? "unknown" : sg === 1 ? "spec" : "inverted (corrected)";
        }
        const det = detectorRef.current;
        if (!det) return;
        handleOutputs(det.push(signValue === -1 ? flipAccel(raw) : raw));
      };
      handlers.current.pushSample = feed;

      const onOrient = (e: DeviceOrientationEvent) => {
        if (e.alpha === null && e.beta === null && e.gamma === null) return;
        if (!gotOrientation) setNoSensor(false);
        gotOrientation = true;
        orient = { alpha: e.alpha ?? 0, beta: e.beta ?? 0, gamma: e.gamma ?? 0 };
        const t = epochNow();
        if (t - lastOrient < MIN_SEND_MS) return;
        lastOrient = t;
        tr.send({ type: "orient", t, seq: seq++, alpha: orient.alpha, beta: orient.beta, gamma: orient.gamma, screenAngle: screenAngle() });
        diag.tx.hit(performance.now());
        if (t - readoutAt > 200) {
          readoutAt = t;
          setReadout(`a ${orient.alpha.toFixed(0)}  b ${orient.beta.toFixed(0)}  g ${orient.gamma.toFixed(0)}`);
        }
      };
      const onMotion = (e: DeviceMotionEvent) => {
        const now = performance.now();
        diag.motionInterval.add(now, e.interval);
        const raw = motionSampleFromEvent(e as unknown as DeviceMotionLike, now / 1000, orient);
        if (raw) feed(raw);
      };
      window.addEventListener("deviceorientation", onOrient);
      window.addEventListener("devicemotion", onMotion);

      // keep the screen awake while streaming (best effort; the request needs the page visible)
      try {
        const nav = navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        nav.wakeLock?.request("screen").then((w) => (wakeRef.current = w)).catch(() => {});
      } catch {
        /* not available */
      }

      const sensorTimer = window.setTimeout(() => {
        if (!gotOrientation) {
          setNoSensor(true);
          setAnnounce("No motion sensor data. Is this a phone, and is motion access on?");
        }
      }, 2500);

      // the laptop shows the phone's own numbers next to its own
      const diagTimer = window.setInterval(() => {
        const s = diag.snapshot();
        diag.extra.motionPermission = permRef.current;
        tr.sendExtra({ type: "diag", t: epochNow(), d: s as unknown as Record<string, unknown> });
      }, 2000);

      const prev = cleanup.current;
      cleanup.current = () => {
        prev();
        window.removeEventListener("deviceorientation", onOrient);
        window.removeEventListener("devicemotion", onMotion);
        window.clearTimeout(sensorTimer);
        window.clearInterval(diagTimer);
      };
    };

    peer.onOpen = () => {
      peer.whenOpen(8000).then(onConnected, () => {
        if (phaseRef.current !== "connected") go("failed");
      });
    };
    peer.pc.addEventListener("connectionstatechange", () => {
      const s = peer.pc.connectionState;
      if (s === "failed") {
        if (phaseRef.current === "connected") setLost(true);
        else go("failed");
      } else if (s === "disconnected" || s === "closed") {
        if (phaseRef.current === "connected") setLost(true);
      } else if (s === "connected") setLost(false);
    });

    const hook: Record<string, unknown> = {
      role: "phone",
      ready: false,
      peer,
      diag: () => diag.snapshot(),
      phase: () => phaseRef.current,
      /** Feeds a motion sample down the same path a devicemotion event takes, with an explicit clock. */
      pushSample: (s: MotionSample) => handlers.current.pushSample(s),
      /** Sends a fabricated gesture, to test the channel without a swing. */
      fakeGesture: () =>
        handleOutputs([
          {
            kind: "event",
            event: {
              type: "golf-swing",
              t: 1,
              peakRate: 20,
              clubSpeed: 38.9,
              clubSpeedMph: 87,
              tempo: 3.1,
              backswingS: 0.9,
              downswingS: 0.29,
              faceAngleDeg: 4,
              planarity: 0.9,
              saturated: false,
              radius: 1.4,
            },
          },
        ]),
    };
    window.__link = hook;

    (async () => {
      try {
        const ans = await peer.acceptOffer(frag.o);
        if (cancelled) return;
        hook.answerPayload = ans.payload;
        setQr(answerQr(ans.payload));
        setAnswerText(ANSWER_PREFIX + ans.payload);
        hook.ready = true;
        go("ready");
      } catch (e) {
        if (!cancelled) {
          hook.error = String(e);
          go("no-offer");
        }
      }
    })();

    cleanup.current = () => {
      window.clearInterval(helloTimer);
      offMsg();
    };
    return () => {
      cancelled = true;
      cleanup.current();
      cleanup.current = () => {};
      tr.close();
      diag.stop();
      peer.close();
      void wakeRef.current?.release?.();
      if (window.__link === hook) delete window.__link;
    };
  }, [go, handleOutputs]);

  // numbers for the badge and the sheet
  useEffect(() => {
    if (phase !== "connected" && phase !== "showing" && phase !== "failed") return;
    const id = window.setInterval(() => setSnap(diagRef.current?.snapshot() ?? null), 500);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "showing") return;
    const id = window.setTimeout(() => setStillWaiting(true), 30000);
    return () => window.clearTimeout(id);
  }, [phase]);

  // The click. requestPermission() has to be the first thing it does, before any await.
  const onPair = async (pairAnyway = false) => {
    let result: MotionPermission = "not-needed";
    if (!pairAnyway) {
      go("asking");
      result = await askMotionPermission();
    } else result = "denied";
    permRef.current = result;
    setPerm(result);
    if (diagRef.current) diagRef.current.extra.motionPermission = result;
    if (result === "denied" && !pairAnyway) {
      go("denied");
      return;
    }
    if (diagRef.current) diagRef.current.marks.shown = performance.now();
    go("showing");
  };

  // ---- swipe up to unlock, then the whole screen is a touchpad ----
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (ctlRef.current !== "live") return;
    drag.current = { y0: e.clientY, t0: performance.now(), y: e.clientY, captured: false };
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
      ctlRef.current = "unlocked";
      setCtl("unlocked");
      setAnnounce("Unlocked. Tap anywhere to tap the phone on your laptop, or switch to the swing test.");
    } else {
      setLockY(0);
      send({ type: "drag", t: epochNow(), dy: 0 });
    }
  };
  const onPadDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (ctlRef.current !== "unlocked" || modeRef.current.mode !== "touchpad") return;
    if ((e.target as HTMLElement).closest("button")) return;
    const r = e.currentTarget.getBoundingClientRect();
    send({ type: "tap", t: epochNow(), x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
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
    ctlRef.current = "live";
    setCtl("live");
    if (modeRef.current.mode !== "touchpad") applyMode("touchpad", modeRef.current.recogniser);
    send({ type: "lock", t: epochNow() });
  };

  const buildPhoneResults = () => ({
    lab: "link",
    version: 1,
    role: "phone",
    at: new Date().toISOString(),
    host: window.location.host,
    secureContext: window.isSecureContext,
    motionPermission: permRef.current,
    snapshot: diagRef.current?.snapshot() ?? snap,
    hello: helloRef.current,
    gesturesSent: sentLines.current,
    gesturesIgnored: swingCountsRef.current.ignored,
  });

  // ---- render ----
  if (phase === "init" || phase === "building") {
    return (
      <div className={css.root}>
        <div className={css.wrap}>
          <h1>Link lab: phone</h1>
          <p className={css.status} role="status" aria-live="polite" data-testid="status" data-phase={phase}>
            Reading the laptop&apos;s code and building your answer.
          </p>
        </div>
      </div>
    );
  }
  if (phase === "unsupported") {
    return (
      <div className={css.root}>
        <div className={css.wrap}>
          <h1>Link lab: phone</h1>
          <div className={css.error} role="alert" data-testid="status" data-phase="unsupported">
            This browser has no WebRTC (RTCPeerConnection), so it can&apos;t connect directly to your laptop. Try current Safari or Chrome.
          </div>
        </div>
      </div>
    );
  }
  if (phase === "no-offer") {
    return (
      <div className={css.root}>
        <div className={css.wrap}>
          <h1>Link lab: phone</h1>
          <div className={css.warn} role="alert" data-testid="status" data-phase="no-offer">
            This page needs the laptop&apos;s code. On your laptop open <b>/lab/link</b>, then scan the QR code it shows with this phone&apos;s camera. If you
            reloaded this page, scan the laptop&apos;s code again.
          </div>
        </div>
      </div>
    );
  }
  if (phase === "ready" || phase === "asking" || phase === "denied") {
    return (
      <div className={css.root}>
        <div className={css.wrap}>
          <h1>Link lab: phone</h1>
          <p className={css.lede}>
            Tap the button, allow motion access if asked, then this screen shows a code. You hold that code up to your laptop&apos;s camera.
          </p>
          {phase === "denied" && (
            <div className={css.error} role="alert" data-testid="denied">
              <p style={{ margin: "0 0 8px" }}>
                Motion access was refused, so tilt, swing and flick can&apos;t work. On iPhone: quit Safari completely, open the laptop&apos;s code again and tap Allow. If it
                still refuses, check Settings, Safari, Motion &amp; Orientation Access (under Advanced on newer iOS).
              </p>
              <div className={css.row}>
                <button type="button" className={css.btn} onClick={() => void onPair(true)}>
                  Pair anyway (connection test only, no tilt)
                </button>
              </div>
            </div>
          )}
          <div className={css.row}>
            <button type="button" className={`${css.btn} ${css.btnPrimary}`} disabled={phase === "asking"} onClick={() => void onPair()} data-testid="pair">
              {phase === "denied" ? "Ask for motion access again" : "Pair with laptop"}
            </button>
          </div>
          <p className={css.status} role="status" aria-live="polite" data-testid="status" data-phase={phase}>
            {phase === "asking" ? "Waiting for your answer to the motion prompt." : "Ready."}
          </p>
        </div>
      </div>
    );
  }
  if (phase === "showing") {
    return (
      <div className={css.root} style={{ display: "grid", placeItems: "center", background: "#0d100e" }}>
        <div className={css.wrap} style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 28 }} data-testid="status" data-phase="showing">
            Hold this up to your laptop&apos;s camera
          </h1>
          <div className={css.qrBox} style={{ margin: "14px auto", width: "fit-content", maxWidth: "100%" }}>
            {qr && <QrCanvas qr={qr} width={qrWidth} label="Answer QR code. Hold it up to your laptop's camera." />}
          </div>
          <p className={css.lede} aria-live="polite">
            Turn the screen brightness up. Hold it about a forearm away from the camera, flat to the lens, until the laptop says it got it.
          </p>
          {perm === "denied" && <div className={css.warn}>Motion access is off, so this will be a connection test only.</div>}
          {stillWaiting && (
            <div className={css.warn} role="status">
              Still waiting. Make sure the laptop&apos;s camera can see the whole code, try moving closer or further, and keep this screen on.
            </div>
          )}
          <details style={{ textAlign: "left" }}>
            <summary>Can&apos;t scan? Show the code as text</summary>
            <p className={css.mono} style={{ overflowWrap: "anywhere", userSelect: "text" }} data-testid="answer-text">
              {answerText}
            </p>
          </details>
        </div>
      </div>
    );
  }
  if (phase === "failed") {
    return (
      <div className={css.root}>
        <div className={css.wrap}>
          <h1>Link lab: phone</h1>
          <div className={css.error} role="alert" data-testid="failure">
            <p style={{ margin: "0 0 8px" }}>{FAIL_TEXT}</p>
            <p style={{ margin: 0 }}>Press Try again on your laptop, then scan its new code with this phone.</p>
          </div>
          <div className={css.card}>
            <DiagList snap={snap} label="Phone diagnostics" testId="diag-phone" />
            <CopyResults build={buildPhoneResults} />
          </div>
        </div>
      </div>
    );
  }

  // ---- connected ----
  const dotCls = lost ? css.dotBad : linked ? css.dotOn : "";
  const chipText = lost ? "link lost" : linked ? `linked${snap?.rtt ? ` ${fmtMs(snap.rtt.lastMs)}` : ""}` : "linking";
  return (
    <section className={mirror.phonePage} aria-label="Phone controller" data-testid="controller" data-ctl={ctl} data-mode={mode}>
      <p className={css.srOnly} role="status" aria-live="polite" data-testid="status" data-phase="connected" data-linked={linked}>
        {announce || (linked ? "Connected." : "Connected. Waiting for the laptop.")}
      </p>

      <div className={css.bar}>
        <span className={css.chip} data-testid="chip">
          <span className={`${css.dot} ${dotCls}`} aria-hidden="true" />
          {chipText}
        </span>
        <button type="button" className={css.chip} onClick={() => setSheet(true)} style={{ color: "#f2ead7" }}>
          Diagnostics
        </button>
      </div>

      {/* under the lock layer: touchpad or swing test */}
      <div className={mirror.pad} onPointerDown={onPadDown} data-testid="pad" data-phase={ctl === "unlocked" ? "unlocked" : "locked"} style={{ touchAction: "none" }}>
        <div className={mirror.padInner}>
          <div className={css.seg} role="group" aria-label="Mode" style={{ marginBottom: 16 }}>
            <button type="button" aria-pressed={mode === "touchpad"} onClick={() => applyMode("touchpad", recogniser)}>
              Touchpad
            </button>
            <button type="button" aria-pressed={mode === "swing"} onClick={() => applyMode("swing", recogniser)} data-testid="swing-toggle">
              Swing test
            </button>
          </div>

          {mode === "touchpad" ? (
            <>
              <h1 className={mirror.big}>Unlocked.</h1>
              <p className={mirror.sub}>Tap anywhere. It lands on the phone on your laptop.</p>
            </>
          ) : (
            <div className={css.swing}>
              <div className={css.seg} role="group" aria-label="Gesture to detect" style={{ marginBottom: 10 }}>
                <button type="button" aria-pressed={recogniser === "golf"} onClick={() => applyMode("swing", "golf")} data-testid="pick-golf">
                  Golf
                </button>
                <button type="button" aria-pressed={recogniser === "flick"} onClick={() => applyMode("swing", "flick")} data-testid="pick-flick">
                  Flick
                </button>
              </div>
              <p className={mirror.sub}>
                {recogniser === "golf"
                  ? "Hold the phone like a club grip, keep still for a moment, then swing."
                  : "Hold the phone steady, screen up, then flick it upward like a basketball shot."}
              </p>
              <p className={css.swingLine} data-testid="swing-last" aria-live="polite">
                {swingLast || "Listening"}
              </p>
              <p className={mirror.readout}>
                {swingCounts.sent} sent, {swingCounts.ignored} ignored{swingCounts.lastIgnored ? `. Last ignored: ${swingCounts.lastIgnored}` : ""}
              </p>
            </div>
          )}
          {noSensor && (
            <p className={css.warn} role="alert">
              No motion data is arriving. This needs a phone with motion sensors, HTTPS, and motion access allowed.
            </p>
          )}
          <p className={mirror.readout} style={{ marginTop: 14 }}>
            {readout}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
            <button type="button" className={mirror.ghost} onClick={recentre}>
              Re-centre
            </button>
            <button type="button" className={mirror.ghost} onClick={lockedAgain}>
              Lock again
            </button>
          </div>
        </div>
        {taps.map((t) => (
          <span key={t.id} className={mirror.tapDot} style={{ left: t.x, top: t.y }} />
        ))}
      </div>

      {/* the lock layer: follows the finger, like the site's */}
      <div
        className={mirror.phoneLock}
        data-testid="phone-lock"
        style={{
          transform: `translateY(${lockY}px)`,
          transition: dragging ? "none" : "transform 0.48s cubic-bezier(0.32,0.72,0,1)",
          pointerEvents: ctl === "unlocked" ? "none" : "auto",
          touchAction: "none",
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div>
          <p className={mirror.readout} data-testid="readout">
            {readout}
          </p>
        </div>
        <div>
          <h1 className={mirror.big}>{linked ? "Tilt me." : "Linking"}</h1>
          <p className={mirror.sub}>{linked ? "Your laptop's phone is following." : "Waiting for your laptop to answer."}</p>
        </div>
        <div>
          <svg className={mirror.chev} width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 15l6-6 6 6" />
          </svg>
          <p className={mirror.sub} style={{ fontWeight: 600 }}>
            Swipe up to unlock
          </p>
          <div style={{ marginTop: 14 }}>
            <button type="button" className={mirror.ghost} onClick={recentre}>
              Re-centre
            </button>
          </div>
        </div>
      </div>

      {sheet && (
        <div className={css.sheet} role="dialog" aria-modal="true" aria-label="Diagnostics" data-testid="sheet">
          <div className={css.row} style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Diagnostics</h2>
            <button type="button" className={css.btn} onClick={() => setSheet(false)}>
              Close
            </button>
          </div>
          <DiagList snap={snap} label="Phone" testId="diag-phone" />
          <CopyResults build={buildPhoneResults} />
          <p className={css.mono} style={{ opacity: 0.7 }}>
            The laptop page shows these numbers too and has the combined Copy results button.
          </p>
        </div>
      )}
    </section>
  );
}
