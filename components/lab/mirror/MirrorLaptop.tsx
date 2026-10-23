"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { OrientationPipeline, DEFAULT_PIPELINE } from "@/lib/lab/mirror/pipeline";
import { Conventions, deviceToCss, toMatrix3d } from "@/lib/lab/mirror/orientation";
import { DEG, qLog, qToMatrix } from "@/lib/lab/mirror/quat";
import { BroadcastChannelTransport, ClockSync, MirrorMessage, Transport, epochNow } from "@/lib/lab/mirror/transport";
import PhoneMockup, { PhoneMockupHandle } from "./PhoneMockup";
import css from "./mirror.module.css";

type Status = "waiting" | "calibrating" | "live" | "stalled";

interface Hud {
  rate: number;
  latency: number;
  rtt: number;
  offset: number;
  ahead: number;
  cutoff: number;
  tilt: [number, number, number];
  accel: number;
  rot: number;
  platform: string;
}

const STATUS_TEXT: Record<Status, string> = {
  waiting: "Waiting for a phone. Open the phone page in another tab on this machine.",
  calibrating: "Phone found. Hold it how you like; that becomes flat.",
  live: "Connected. Tilt the phone, swipe up on it to unlock.",
  stalled: "Lost the phone (no reply for 6 seconds).",
};

declare global {
  interface Window {
    __mirror?: {
      samples: { t: number; tArr: number; alpha: number; beta: number; gamma: number }[];
      pipeline: OrientationPipeline;
      clock: ClockSync;
      sent: () => number;
    };
  }
}

export default function MirrorLaptop({ room = "default" }: { room?: string }) {
  const mock = useRef<PhoneMockupHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pipe = useRef<OrientationPipeline | null>(null);
  const clock = useRef(new ClockSync());
  const transport = useRef<Transport | null>(null);
  const stats = useRef({ count: 0, lastCount: 0, lastRateAt: 0, rate: 0, latency: 0, lastSampleAt: 0, lastAliveAt: 0, connected: false, platform: "-", accel: 0, rot: 0 });
  const [status, setStatus] = useState<Status>("waiting");
  const [locked, setLocked] = useState(true);
  const [scale, setScale] = useState(0.8);
  const [hud, setHud] = useState<Hud | null>(null);
  const [announce, setAnnounce] = useState("");

  // live settings
  const [minCutoff, setMinCutoff] = useState(DEFAULT_PIPELINE.filter.minCutoff);
  const [beta, setBeta] = useState(DEFAULT_PIPELINE.filter.beta);
  const [predict, setPredict] = useState(DEFAULT_PIPELINE.predict);
  const [lagComp, setLagComp] = useState(DEFAULT_PIPELINE.lagCompensation);
  const [maxTilt, setMaxTilt] = useState(Math.round(DEFAULT_PIPELINE.clamp.maxTilt / DEG));
  const [conv, setConv] = useState<Conventions>(DEFAULT_PIPELINE.conventions);

  if (pipe.current === null && typeof window !== "undefined") pipe.current = new OrientationPipeline();

  // fit the phone to the stage
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      setScale(Math.max(0.3, Math.min(1, (r.height * 0.86) / 880, (r.width * 0.8) / 440)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // push settings into the pipeline
  useEffect(() => {
    pipe.current?.configure({
      filter: { minCutoff, beta, dCutoff: DEFAULT_PIPELINE.filter.dCutoff },
      predict,
      lagCompensation: lagComp,
      clamp: { maxTilt: maxTilt * DEG, maxRoll: (maxTilt * 0.76) * DEG },
      conventions: conv,
    });
  }, [minCutoff, beta, predict, lagComp, maxTilt, conv]);

  const recalibrate = useCallback(() => {
    pipe.current?.recalibrate(epochNow());
    setStatus("calibrating");
  }, []);

  const relock = useCallback(() => {
    mock.current?.lock();
    transport.current?.send({ type: "lock", t: epochNow() });
  }, []);

  // transport, message handling, ping loop
  useEffect(() => {
    const p = pipe.current;
    if (!p) return;
    const tr = new BroadcastChannelTransport(room);
    transport.current = tr;
    const st = stats.current;
    const probe = new URLSearchParams(window.location.search).has("probe");
    let sent = 0;
    if (probe) window.__mirror = { samples: [], pipeline: p, clock: clock.current, sent: () => sent };

    const ping = () => {
      tr.send({ type: "ping", t0: epochNow() });
      sent++;
    };
    let pingTimer = 0;
    let burst = 0;
    const startPings = () => {
      window.clearTimeout(pingTimer);
      burst = 0;
      const next = () => {
        ping();
        burst++;
        pingTimer = window.setTimeout(next, burst < 6 ? 120 : 2000);
      };
      next();
    };

    const connect = (platform?: string) => {
      const now = epochNow();
      st.connected = true;
      st.count = 0;
      st.lastCount = 0;
      st.lastSampleAt = now;
      st.lastAliveAt = now;
      if (platform) st.platform = platform;
      p.reset(now);
      clock.current = new ClockSync();
      if (window.__mirror) window.__mirror.clock = clock.current;
      tr.send({ type: "ready", t: now });
      startPings();
      setStatus("calibrating");
      setAnnounce("Phone connected.");
    };

    const off = tr.onMessage((m: MirrorMessage) => {
      const now = epochNow();
      st.lastAliveAt = now; // any message, pongs included, proves the phone page is alive
      switch (m.type) {
        case "hello":
          connect(m.platform);
          break;
        case "orient": {
          if (!st.connected) connect();
          const tLocal = m.t - clock.current.offset;
          st.count++;
          st.lastSampleAt = now;
          const lat = Math.max(0, now - tLocal);
          st.latency = st.latency === 0 ? lat : st.latency + 0.1 * (lat - st.latency);
          p.push({ alpha: m.alpha, beta: m.beta, gamma: m.gamma, screenAngle: m.screenAngle }, tLocal);
          if (window.__mirror) {
            const s = window.__mirror.samples;
            s.push({ t: m.t, tArr: now, alpha: m.alpha, beta: m.beta, gamma: m.gamma });
            if (s.length > 20000) s.splice(0, 5000);
          }
          break;
        }
        case "motion":
          st.accel = Math.hypot(m.ax, m.ay, m.az);
          st.rot = Math.hypot(m.ra, m.rb, m.rg);
          break;
        case "drag":
          mock.current?.setDrag(m.dy === 0 ? null : m.dy);
          break;
        case "unlock":
          mock.current?.unlock();
          break;
        case "tap":
          mock.current?.ripple(m.x, m.y);
          break;
        case "recalibrate":
          p.recalibrate(now);
          setStatus("calibrating");
          break;
        case "pong":
          clock.current.addPong(m.t0, m.t1, now);
          break;
        default:
          break;
      }
    });

    // draw loop: one pose per frame, straight to the DOM
    let raf = 0;
    const loop = () => {
      const now = epochNow();
      const pose = p.pose(now);
      const m = qToMatrix(deviceToCss(pose.q));
      mock.current?.setPose(toMatrix3d(pose.q), Math.max(-1, Math.min(1, m[0][2] * 2.2)));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // status + HUD at 4 Hz (React does not need 60)
    const hudTimer = window.setInterval(() => {
      const now = epochNow();
      const dt = (now - st.lastRateAt) / 1000;
      if (dt > 0) {
        st.rate = (st.count - st.lastCount) / dt;
        st.lastCount = st.count;
        st.lastRateAt = now;
      }
      const pose = p.pose(now);
      const v = qLog(pose.q);
      if (st.connected) {
        // Chrome sends nothing while the phone is held still, so silence alone is not a stall;
        // the ping/pong keeps flowing as long as the phone page is alive
        const gone = now - st.lastAliveAt > 6000;
        setStatus(gone ? "stalled" : p.calibrated ? "live" : "calibrating");
      }
      setHud({
        rate: st.rate,
        latency: st.latency,
        rtt: clock.current.rtt === Infinity ? 0 : clock.current.rtt,
        offset: clock.current.offset,
        ahead: pose.extrapolatedMs,
        cutoff: pose.cutoffHz,
        tilt: [v.x / DEG, v.y / DEG, v.z / DEG],
        accel: st.accel,
        rot: st.rot,
        platform: st.platform,
      });
    }, 250);

    return () => {
      off();
      tr.close();
      transport.current = null;
      window.clearTimeout(pingTimer);
      window.clearInterval(hudTimer);
      cancelAnimationFrame(raf);
      if (window.__mirror) delete window.__mirror;
    };
  }, [room]);

  const onLockedChange = useCallback((l: boolean) => {
    setLocked(l);
    setAnnounce(l ? "Locked." : "Unlocked.");
  }, []);

  const dotClass = status === "live" ? css.dotLive : status === "waiting" ? "" : css.dotWarn;
  const flip = (k: keyof Conventions) => setConv((c) => ({ ...c, [k]: !c[k] }));

  return (
    <section className={css.page} aria-label="Phone mirror lab">
      <div ref={stageRef} className={css.stage}>
        <div className={css.scale} style={{ "--s": scale } as React.CSSProperties}>
          <PhoneMockup ref={mock} onLockedChange={onLockedChange} />
        </div>
      </div>

      <aside className={css.panel} aria-label="Connection and tuning">
        <h1>Mirror lab</h1>
        <div className={css.statusLine}>
          <span className={`${css.dot} ${dotClass}`} aria-hidden="true" />
          <span data-testid="status" data-status={status}>
            {STATUS_TEXT[status]}
          </span>
        </div>
        <p className={css.srOnly} role="status" aria-live="polite">
          {announce}
        </p>
        <div className={css.row}>
          <a className={css.btnLink} href="/lab/mirror/phone" target="_blank" rel="noopener">
            Open phone page
          </a>
          <button type="button" onClick={recalibrate}>
            Re-centre
          </button>
          <button type="button" onClick={relock} disabled={locked} aria-disabled={locked}>
            Lock again
          </button>
        </div>

        <h2>Feel</h2>
        <label className={css.field}>
          Smoothing at rest (min cutoff Hz)
          <output>{minCutoff.toFixed(1)}</output>
          <input type="range" min={0.3} max={6} step={0.1} value={minCutoff} onChange={(e) => setMinCutoff(+e.target.value)} />
        </label>
        <label className={css.field}>
          Speed opens it up (beta)
          <output>{beta.toFixed(1)}</output>
          <input type="range" min={0} max={12} step={0.5} value={beta} onChange={(e) => setBeta(+e.target.value)} />
        </label>
        <label className={css.field}>
          Lag compensation
          <output>{lagComp.toFixed(2)}</output>
          <input type="range" min={0} max={1} step={0.05} value={lagComp} onChange={(e) => setLagComp(+e.target.value)} />
        </label>
        <label className={css.field}>
          Max tilt (degrees)
          <output>{maxTilt}</output>
          <input type="range" min={10} max={70} step={1} value={maxTilt} onChange={(e) => setMaxTilt(+e.target.value)} />
        </label>
        <label className={css.check}>
          <input type="checkbox" checked={predict} onChange={(e) => setPredict(e.target.checked)} />
          Predict ahead (hides transport latency)
        </label>

        <h2>If it tilts the wrong way</h2>
        <div className={css.row}>
          <label className={css.check}>
            <input type="checkbox" checked={conv.flipAlpha} onChange={() => flip("flipAlpha")} />
            flip alpha
          </label>
          <label className={css.check}>
            <input type="checkbox" checked={conv.flipBeta} onChange={() => flip("flipBeta")} />
            flip beta
          </label>
          <label className={css.check}>
            <input type="checkbox" checked={conv.flipGamma} onChange={() => flip("flipGamma")} />
            flip gamma
          </label>
        </div>

        <h2>Telemetry</h2>
        <dl className={css.hud} data-testid="hud">
          <dt>platform</dt>
          <dd>{hud?.platform ?? "-"}</dd>
          <dt>samples / s</dt>
          <dd>{hud ? hud.rate.toFixed(0) : "-"}</dd>
          <dt>one-way latency</dt>
          <dd>{hud ? `${hud.latency.toFixed(1)} ms` : "-"}</dd>
          <dt>ping rtt</dt>
          <dd>{hud ? `${hud.rtt.toFixed(1)} ms` : "-"}</dd>
          <dt>clock offset</dt>
          <dd>{hud ? `${hud.offset.toFixed(1)} ms` : "-"}</dd>
          <dt>predicting ahead</dt>
          <dd>{hud ? `${hud.ahead.toFixed(0)} ms` : "-"}</dd>
          <dt>filter cutoff</dt>
          <dd>{hud ? `${hud.cutoff.toFixed(1)} Hz` : "-"}</dd>
          <dt>tilt x / y / z</dt>
          <dd>{hud ? hud.tilt.map((n) => n.toFixed(0)).join(" / ") + "°" : "-"}</dd>
          <dt>|accel| / |rot|</dt>
          <dd>{hud ? `${hud.accel.toFixed(1)} / ${hud.rot.toFixed(0)}` : "-"}</dd>
        </dl>
        <p className={css.note}>
          Lab prototype: BroadcastChannel between two tabs on one machine. Swap the transport for a WebRTC data channel and nothing
          else changes. No cookies, storage or third-party requests.
        </p>
      </aside>
    </section>
  );
}
