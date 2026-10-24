"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import QrCanvas from "@/components/lab/handshake/QrCanvas";
import Scanner from "@/components/lab/handshake/Scanner";
import Portal from "@/components/lab/mirror/Portal";
import PhoneMockup, { type PhoneMockupHandle } from "@/components/lab/mirror/PhoneMockup";
import mirror from "@/components/lab/mirror/mirror.module.css";
import { HandshakePeer } from "@/lib/lab/handshake/peer";
import { offerQr, type QrMatrix } from "@/lib/lab/handshake/qr";
import { DEFAULT_PIPELINE, OrientationPipeline } from "@/lib/lab/mirror/pipeline";
import { deviceToCss, toMatrix3d, type Conventions } from "@/lib/lab/mirror/orientation";
import { qToMatrix } from "@/lib/lab/mirror/quat";
import { ClockSync, epochNow } from "@/lib/lab/mirror/transport";
import { buildResults, fmtMs, LinkDiagnostics, type GestureLogEntry, type LinkSnapshot } from "@/lib/lab/link/diagnostics";
import { describeGesture, type PhoneMode, type Recogniser } from "@/lib/lab/link/protocol";
import { HandshakeTransport } from "@/lib/lab/link/transport";
import { CopyResults, DiagList } from "./DiagPanel";
import css from "./link.module.css";

type Phase = "init" | "offer" | "connecting" | "connected" | "failed" | "unsupported";
type MirrorStatus = "waiting" | "calibrating" | "live" | "stalled";

export const CONNECT_TIMEOUT_MS = 15000;
export const FAIL_TEXT =
  "Couldn't connect directly. Are both devices on the same Wi-Fi? Guest, hotel and campus networks often block this.";

const MIRROR_TEXT: Record<MirrorStatus, string> = {
  waiting: "Linked. Waiting for the phone to say hello.",
  calibrating: "Phone found. Hold it how you like; that becomes flat.",
  live: "Connected. Tilt the phone, swipe up on it to unlock.",
  stalled: "Lost the phone (no reply for 6 seconds).",
};

declare global {
  interface Window {
    __link?: Record<string, unknown>;
  }
}

interface Hello {
  ua: string;
  platform: string;
  screen: { w: number; h: number };
}

interface GestureShown {
  gesture: string;
  line: string;
  n: number;
}

export default function LinkLaptop() {
  return (
    <Portal>
      <LinkLaptopInner />
    </Portal>
  );
}

function LinkLaptopInner() {
  const [session, setSession] = useState(0);
  const [phase, setPhase] = useState<Phase>("init");
  const [qr, setQr] = useState<QrMatrix | null>(null);
  const [scanning, setScanning] = useState(false);
  const [paste, setPaste] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [snap, setSnap] = useState<LinkSnapshot | null>(null);
  const [phoneSnap, setPhoneSnap] = useState<Record<string, unknown> | null>(null);
  const [hello, setHello] = useState<Hello | null>(null);
  const [mirrorStatus, setMirrorStatus] = useState<MirrorStatus>("waiting");
  const [phoneMode, setPhoneMode] = useState<{ mode: PhoneMode; recogniser: Recogniser | null }>({ mode: "touchpad", recogniser: null });
  const [gesture, setGesture] = useState<GestureShown | null>(null);
  const [gestureLog, setGestureLog] = useState<GestureLogEntry[]>([]);
  const [rejects, setRejects] = useState<{ n: number; last: string }>({ n: 0, last: "" });
  const [locked, setLocked] = useState(true);
  const [scale, setScale] = useState(0.8);
  const [announce, setAnnounce] = useState("");
  const [conv, setConv] = useState<Conventions>(DEFAULT_PIPELINE.conventions);
  const [clockInfo, setClockInfo] = useState<{ rttMs: number | null; offsetMs: number | null }>({ rttMs: null, offsetMs: null });

  const mock = useRef<PhoneMockupHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pipe = useRef<OrientationPipeline | null>(null);
  const clock = useRef(new ClockSync());
  const peerRef = useRef<HandshakePeer | null>(null);
  const diagRef = useRef<LinkDiagnostics | null>(null);
  const trRef = useRef<HandshakeTransport | null>(null);
  const live = useRef({ connected: false, lastAliveAt: 0 });
  const failureRef = useRef<string | null>(null);
  const answered = useRef(false);
  const gestureCount = useRef(0);
  const gestureLogRef = useRef<GestureLogEntry[]>([]);
  const rejectsRef = useRef(0);
  const phoneSnapRef = useRef<Record<string, unknown> | null>(null);
  const helloRef = useRef<Hello | null>(null);
  const clockRef = useRef(clockInfo);
  clockRef.current = clockInfo;
  const submitRef = useRef<(payload: string) => Promise<void>>(async () => {});

  if (pipe.current === null && typeof window !== "undefined") pipe.current = new OrientationPipeline();

  useEffect(() => {
    pipe.current?.configure({ conventions: conv });
  }, [conv]);

  // fit the phone to the stage once it exists
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || phase !== "connected") return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      setScale(Math.max(0.3, Math.min(1, (r.height * 0.86) / 880, (r.width * 0.8) / 440)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase]);

  // one pairing attempt: peer, offer, answer, link, messages
  useEffect(() => {
    if (typeof RTCPeerConnection === "undefined") {
      setPhase("unsupported");
      return;
    }
    let cancelled = false;
    let failTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer = 0;
    const peer = new HandshakePeer([]);
    const diag = new LinkDiagnostics("laptop");
    const tr = new HandshakeTransport(peer);
    const p = pipe.current!;
    const st = live.current;
    peerRef.current = peer;
    diagRef.current = diag;
    trRef.current = tr;
    answered.current = false;
    failureRef.current = null;
    gestureCount.current = 0;
    gestureLogRef.current = [];
    rejectsRef.current = 0;
    phoneSnapRef.current = null;
    helloRef.current = null;
    st.connected = false;
    st.lastAliveAt = 0;
    diag.marks.shown = performance.now();
    setPhase("init");
    setQr(null);
    setScanning(false);
    setProblem(null);
    setSnap(null);
    setPhoneSnap(null);
    setHello(null);
    setMirrorStatus("waiting");
    setPhoneMode({ mode: "touchpad", recogniser: null });
    setGesture(null);
    setGestureLog([]);
    setRejects({ n: 0, last: "" });
    setLocked(true);
    clock.current = new ClockSync();

    const fail = (why: string) => {
      if (cancelled || st.connected) return;
      failureRef.current = why;
      setProblem(why);
      setPhase("failed");
      setScanning(false);
    };

    const onConnected = () => {
      if (cancelled || st.connected) return;
      st.connected = true;
      st.lastAliveAt = epochNow();
      clearTimeout(failTimer);
      failureRef.current = null;
      diag.marks.open = performance.now();
      diag.attach(peer);
      setProblem(null);
      setPhase("connected");
      setScanning(false);
      setAnnounce("Phone linked.");
    };
    peer.onOpen = () => {
      peer.whenOpen(8000).then(onConnected, () => fail("The data channels did not open."));
    };
    peer.pc.addEventListener("connectionstatechange", () => {
      if (peer.pc.connectionState === "failed") fail(FAIL_TEXT);
    });

    const submitAnswer = async (payload: string) => {
      if (cancelled || answered.current) return;
      answered.current = true;
      diag.marks.answer = performance.now();
      setScanning(false);
      setPhase("connecting");
      clearTimeout(failTimer);
      failTimer = setTimeout(() => fail(FAIL_TEXT), CONNECT_TIMEOUT_MS);
      try {
        await peer.acceptAnswer(payload);
      } catch (e) {
        // a bad scan: let the person try again with the camera
        answered.current = false;
        diag.marks.answer = undefined;
        clearTimeout(failTimer);
        setProblem(`That code didn't read correctly (${e instanceof Error ? e.message : String(e)}). Hold the phone steady and try again.`);
        setPhase("offer");
        setScanning(true);
      }
    };
    submitRef.current = submitAnswer;

    // ---- messages from the phone ----
    const connect = (h?: Hello) => {
      const now = epochNow();
      p.reset(now);
      clock.current = new ClockSync();
      tr.send({ type: "ready", t: now });
      window.clearTimeout(pingTimer);
      let burst = 0;
      const next = () => {
        tr.send({ type: "ping", t0: epochNow() });
        burst++;
        pingTimer = window.setTimeout(next, burst < 6 ? 120 : 2000);
      };
      next();
      if (h) {
        helloRef.current = h;
        setHello(h);
      }
      setMirrorStatus("calibrating");
      setAnnounce("Phone connected.");
    };
    let helloed = false;
    const offMsg = tr.onMessage((m) => {
      const now = epochNow();
      st.lastAliveAt = now;
      switch (m.type) {
        case "hello":
          if (!helloed) {
            helloed = true;
            connect({ ua: m.ua, platform: m.platform, screen: m.screen });
          } else tr.send({ type: "ready", t: now }); // the phone did not hear us yet
          break;
        case "orient": {
          if (!helloed) {
            helloed = true;
            connect();
          }
          diag.seq.add(m.seq);
          diag.rx.hit(performance.now());
          p.push({ alpha: m.alpha, beta: m.beta, gamma: m.gamma, screenAngle: m.screenAngle }, m.t - clock.current.offset);
          break;
        }
        case "drag":
          mock.current?.setDrag(m.dy === 0 ? null : m.dy);
          break;
        case "unlock":
          mock.current?.unlock();
          break;
        case "lock":
          mock.current?.lock();
          break;
        case "tap":
          mock.current?.ripple(m.x, m.y);
          break;
        case "recalibrate":
          p.recalibrate(now);
          setMirrorStatus("calibrating");
          break;
        case "pong":
          clock.current.addPong(m.t0, m.t1, now);
          break;
        default:
          break;
      }
    });
    const offExtra = tr.onExtra((m) => {
      st.lastAliveAt = epochNow();
      switch (m.type) {
        case "gesture": {
          const d = describeGesture(m);
          gestureCount.current++;
          const entry: GestureLogEntry = { at: new Date().toISOString(), line: d.line, gesture: m.gesture };
          gestureLogRef.current = [...gestureLogRef.current.slice(-19), entry];
          setGesture({ gesture: m.gesture, line: d.line, n: gestureCount.current });
          setGestureLog(gestureLogRef.current);
          setAnnounce(d.line);
          break;
        }
        case "gesture-reject":
          rejectsRef.current++;
          setRejects({ n: rejectsRef.current, last: `${m.gesture}: ${m.reason}${m.detail ? ` (${m.detail})` : ""}` });
          break;
        case "mode":
          setPhoneMode({ mode: m.mode, recogniser: m.recogniser });
          break;
        case "diag":
          phoneSnapRef.current = m.d;
          setPhoneSnap(m.d);
          break;
      }
    });

    // status and numbers at 4 Hz (React does not need 60)
    const tick = window.setInterval(() => {
      const now = epochNow();
      setSnap(diag.snapshot());
      setClockInfo({
        rttMs: clock.current.rtt === Infinity ? null : clock.current.rtt,
        offsetMs: st.connected && helloed ? clock.current.offset : null,
      });
      if (st.connected && helloed) {
        const gone = now - st.lastAliveAt > 6000;
        setMirrorStatus(gone ? "stalled" : p.calibrated ? "live" : "calibrating");
      }
    }, 250);

    // the same hook the handshake lab has, so tests can stand in for the camera
    const hook: Record<string, unknown> = {
      role: "laptop",
      ready: false,
      submitAnswer,
      peer,
      diag: () => diag.snapshot(),
      phase: () => (st.connected ? "connected" : answered.current ? "connecting" : "offer"),
    };
    window.__link = hook;

    (async () => {
      try {
        const offer = await peer.createOffer();
        if (cancelled) return;
        diag.marks.offerReady = performance.now();
        const origin = window.location.origin;
        const q = offerQr(origin, offer.payload, "L", "/lab/link/phone");
        hook.offerUrl = `${origin}/lab/link/phone#o=${offer.payload}`;
        hook.offerPayload = offer.payload;
        hook.ready = true;
        setQr(q);
        setPhase("offer");
        setScanning(true);
      } catch (e) {
        if (!cancelled) fail(`Could not start pairing: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(failTimer);
      window.clearTimeout(pingTimer);
      window.clearInterval(tick);
      offMsg();
      offExtra();
      tr.close();
      diag.stop();
      peer.close();
      if (window.__link === hook) delete window.__link;
    };
  }, [session]);

  // draw loop: one pose per frame, straight to the DOM
  useEffect(() => {
    if (phase !== "connected") return;
    const p = pipe.current!;
    let raf = 0;
    const loop = () => {
      const pose = p.pose(epochNow());
      const m = qToMatrix(deviceToCss(pose.q));
      mock.current?.setPose(toMatrix3d(pose.q), Math.max(-1, Math.min(1, m[0][2] * 2.2)));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const recalibrate = () => {
    pipe.current?.recalibrate(epochNow());
    setMirrorStatus("calibrating");
  };
  const relock = () => {
    mock.current?.lock();
    trRef.current?.send({ type: "lock", t: epochNow() });
  };
  const flip = (k: keyof Conventions) => setConv((c) => ({ ...c, [k]: !c[k] }));
  const tryAgain = () => setSession((s) => s + 1);

  const buildCopy = () =>
    buildResults({
      origin: window.location.origin,
      laptop: diagRef.current?.snapshot() ?? snap!,
      phone: phoneSnapRef.current,
      phoneHello: helloRef.current,
      clock: { rttMs: clockRef.current.rttMs, offsetMs: clockRef.current.offsetMs },
      gestures: gestureLogRef.current,
      gestureRejects: rejectsRef.current,
      failure: failureRef.current,
    });

  // ---- render ----
  if (phase === "unsupported") {
    return (
      <div className={css.root}>
        <div className={css.wrap}>
          <h1>Link lab: laptop</h1>
          <div className={css.error} role="alert" data-testid="status" data-phase="unsupported">
            This browser has no WebRTC (RTCPeerConnection), so the phone can&apos;t connect directly. Try current Chrome, Edge, Firefox or Safari.
          </div>
        </div>
      </div>
    );
  }

  if (phase !== "connected") {
    const statusText =
      phase === "init"
        ? "Preparing the pairing code."
        : phase === "offer"
          ? "Step 1: scan the code with your phone's camera. Step 2: your phone then shows a code; hold it up to this laptop's camera."
          : phase === "connecting"
            ? "Got the phone's code. Connecting directly, up to 15 seconds."
            : "Not connected.";
    return (
      <div className={css.root}>
        <div className={css.wrap}>
          <h1>Link lab: laptop</h1>
          <p className={css.lede}>
            Pairs your real phone with this page over a direct WebRTC link. No server relays anything: the two codes carry the connection details.
          </p>
          <p className={css.status} aria-live="polite" data-testid="status" data-phase={phase}>
            {statusText}
          </p>
          {problem && phase !== "failed" && (
            <div className={css.warn} role="alert">
              {problem}
            </div>
          )}
          {phase === "failed" && (
            <div className={css.error} role="alert" data-testid="failure">
              <p style={{ margin: "0 0 10px" }}>{problem}</p>
              <button type="button" className={css.btn} onClick={tryAgain}>
                Try again
              </button>
              <p className={css.mono} style={{ margin: "10px 0 0", opacity: 0.8 }}>
                Then scan the new code on your phone. If it connects late after all, this page switches to the live view by itself.
              </p>
            </div>
          )}
          <div className={css.cols}>
            <section className={css.card} aria-label="Pairing code">
              <h2>1. Scan with your phone</h2>
              <div className={css.qrBox}>
                {qr ? <QrCanvas qr={qr} width={340} label="Pairing QR code. Scan it with your phone's camera." /> : <span style={{ color: "#333" }}>Preparing</span>}
              </div>
            </section>
            <section className={css.card} aria-label="Scan the phone's answer">
              <h2>2. Show your phone to this camera</h2>
              {scanning ? (
                <Scanner
                  key={`scan-${session}`}
                  onAnswer={(a) => void submitRef.current(a)}
                />
              ) : phase === "offer" ? (
                <button type="button" className={css.btn} onClick={() => setScanning(true)}>
                  Open camera
                </button>
              ) : (
                <p className={css.mono}>{phase === "connecting" ? "Camera off." : ""}</p>
              )}
              <details style={{ marginTop: 12 }}>
                <summary>Camera not working? Paste the phone&apos;s code as text (the phone has a &ldquo;show the code as text&rdquo; link)</summary>
                <div className={css.row}>
                  <label>
                    <span className={css.srOnly}>Phone code</span>
                    <input value={paste} onChange={(e) => setPaste(e.target.value)} style={{ width: 240, color: "#0d100e" }} placeholder="HS1.…" />
                  </label>
                  <button
                    type="button"
                    className={css.btn}
                    onClick={() => {
                      const t = paste.trim().toUpperCase().replace(/^HS1\./, "");
                      if (t) void submitRef.current(t);
                    }}
                  >
                    Use pasted code
                  </button>
                </div>
              </details>
            </section>
          </div>
          {snap && (phase === "connecting" || phase === "failed") && (
            <div className={css.card} style={{ marginTop: 16 }}>
              <DiagList snap={snap} label="Laptop diagnostics" testId="diag-laptop" />
              <CopyResults build={buildCopy} />
            </div>
          )}
        </div>
      </div>
    );
  }

  const dotClass = mirrorStatus === "live" ? mirror.dotLive : mirrorStatus === "waiting" ? "" : mirror.dotWarn;
  return (
    <section className={mirror.page} aria-label="Link lab">
      <div ref={stageRef} className={mirror.stage}>
        <div className={mirror.scale} style={{ "--s": scale } as React.CSSProperties}>
          <PhoneMockup
            ref={mock}
            onLockedChange={(l) => {
              setLocked(l);
              setAnnounce(l ? "Locked." : "Unlocked.");
            }}
          />
        </div>
      </div>

      <aside className={mirror.panel} aria-label="Connection, gestures and diagnostics">
        <h1>Link lab</h1>
        <div className={mirror.statusLine}>
          <span className={`${mirror.dot} ${dotClass}`} aria-hidden="true" />
          <span data-testid="status" data-status={mirrorStatus} data-phase="connected">
            {MIRROR_TEXT[mirrorStatus]}
          </span>
        </div>
        <p className={css.srOnly} role="status" aria-live="polite">
          {announce}
        </p>
        <div className={mirror.row}>
          <button type="button" onClick={recalibrate}>
            Re-centre
          </button>
          <button type="button" onClick={relock} disabled={locked} aria-disabled={locked}>
            Lock again
          </button>
          <button type="button" onClick={tryAgain}>
            Pair again
          </button>
        </div>

        <h2>Swing test</h2>
        <div className={css.gesture}>
          <div className={css.gestureMeta} data-testid="phone-mode">
            Phone mode: {phoneMode.mode === "swing" ? `Swing test (${phoneMode.recogniser ?? "none"})` : "Touchpad"}
          </div>
          <div className={css.gestureBig} data-testid="gesture-big" aria-live="polite">
            {gesture ? gesture.line : "No gesture yet"}
          </div>
          <div className={css.gestureMeta} data-testid="gesture-meta">
            {gestureLog.length} detected{gesture ? ` (#${gesture.n})` : ""}, {rejects.n} ignored{rejects.last ? `. Last ignored: ${rejects.last}` : ""}
          </div>
          {gestureLog.length > 1 && (
            <ol className={css.gestureLog} reversed>
              {[...gestureLog]
                .slice(-6, -1)
                .reverse()
                .map((g, i) => (
                  <li key={`${g.at}-${i}`}>{g.line}</li>
                ))}
            </ol>
          )}
        </div>

        <h2>Diagnostics</h2>
        <DiagList snap={snap} label="Laptop" testId="diag-laptop" />
        <DiagList snap={phoneSnap as Partial<LinkSnapshot> | null} label={`Phone${hello ? ` (${hello.platform})` : ""}`} testId="diag-phone" />
        <dl className={mirror.hud}>
          <dt>clock sync rtt</dt>
          <dd>{fmtMs(clockInfo.rttMs)}</dd>
          <dt>clock offset</dt>
          <dd>{fmtMs(clockInfo.offsetMs)}</dd>
        </dl>
        <CopyResults build={buildCopy} />

        <details>
          <summary>If it tilts the wrong way</summary>
          <div className={mirror.row} style={{ marginTop: 8 }}>
            <label className={mirror.check}>
              <input type="checkbox" checked={conv.flipAlpha} onChange={() => flip("flipAlpha")} />
              flip alpha
            </label>
            <label className={mirror.check}>
              <input type="checkbox" checked={conv.flipBeta} onChange={() => flip("flipBeta")} />
              flip beta
            </label>
            <label className={mirror.check}>
              <input type="checkbox" checked={conv.flipGamma} onChange={() => flip("flipGamma")} />
              flip gamma
            </label>
          </div>
        </details>
      </aside>
    </section>
  );
}
