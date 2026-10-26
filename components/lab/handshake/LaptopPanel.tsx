"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QrCanvas from "./QrCanvas";
import Scanner, { type ScanStats } from "./Scanner";
import { HandshakePeer, analyzeSequence, summarize } from "@/lib/lab/handshake/peer";
import { makeQr, offerQr, qrMetrics, type QrMatrix, type QrMetrics } from "@/lib/lab/handshake/qr";
import { makeCode, pollSlot, postSlot } from "@/lib/lab/handshake/relay";

type Mode = "qr" | "relay";

interface Report {
  rawSdpBytes: number;
  minPayloadBytes: number;
  payloadChars: number;
  qrChars: number;
  gatherMs: number;
  candidates: ReturnType<HandshakePeer["candidateSummary"]>;
  qr: QrMetrics | null;
  url: string;
}

interface Marks {
  start: number;
  offerReady?: number;
  answerReceived?: number;
  open?: number;
}

declare global {
  interface Window {
    __hs?: Record<string, unknown>;
  }
}

export default function LaptopPanel() {
  const [mode, setMode] = useState<Mode>("qr");
  const [session, setSession] = useState(0);
  const [status, setStatus] = useState("Preparing…");
  const [qr, setQr] = useState<QrMatrix | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanStats, setScanStats] = useState<ScanStats | null>(null);
  const [paste, setPaste] = useState("");
  const [connected, setConnected] = useState(false);
  const [orient, setOrient] = useState<{ a: number; b: number; g: number } | null>(null);
  const [pingRes, setPingRes] = useState<string>("");
  const peerRef = useRef<HandshakePeer | null>(null);
  const marks = useRef<Marks>({ start: 0 });
  const relayInfo = useRef<Record<string, number>>({});

  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("mode");
    if (m === "relay") setMode("relay");
  }, []);

  const submitAnswer = useCallback(async (payload: string) => {
    const peer = peerRef.current;
    if (!peer) return;
    marks.current.answerReceived = performance.now();
    setScanning(false);
    setStatus("Answer received. Connecting…");
    await peer.acceptAnswer(payload);
  }, []);

  useEffect(() => {
    if (typeof RTCPeerConnection === "undefined") {
      setStatus("This browser has no WebRTC (RTCPeerConnection), so peer-to-peer pairing is unavailable.");
      return;
    }
    let cancelled = false;
    const peer = new HandshakePeer([]);
    peerRef.current = peer;
    marks.current = { start: performance.now() };
    relayInfo.current = {};
    setConnected(false);
    setScanning(false);
    setScanStats(null);
    setQr(null);
    setReport(null);
    setCode("");
    peer.onOpen = () => {
      marks.current.open = performance.now();
      setConnected(true);
      setStatus("Connected. Peer-to-peer, no server in the path.");
    };
    peer.onMotion = (m) => setOrient({ a: m.a, b: m.b, g: m.g });

    const hs: Record<string, unknown> = {
      role: "laptop",
      mode,
      peer,
      marks: marks.current,
      relayInfo: relayInfo.current,
      submitAnswer,
      ready: false,
    };
    window.__hs = hs;

    (async () => {
      try {
        setStatus("Gathering ICE candidates (no STUN, host candidates only)…");
        const offer = await peer.createOffer();
        if (cancelled) return;
        marks.current.offerReady = performance.now();
        const origin = window.location.origin;
        let q: QrMatrix;
        let url: string;
        if (mode === "qr") {
          q = offerQr(origin, offer.payload);
          url = `${origin}/lab/handshake/phone#o=${offer.payload}`;
          hs.offerUrl = url;
          hs.offerPayload = offer.payload;
        } else {
          const c = makeCode();
          setCode(c);
          const post = await postSlot(c, "offer", offer.payload);
          relayInfo.current.postOfferMs = post.ms;
          url = `${origin}/lab/handshake/phone#c=${c}`;
          q = makeQr([{ data: url, mode: "Byte" }], "L");
          hs.code = c;
          hs.offerUrl = url;
          hs.offerPayload = offer.payload;
        }
        const rep: Report = {
          rawSdpBytes: offer.rawSdp.length,
          minPayloadBytes: Math.round((offer.payload.length * 2) / 3),
          payloadChars: offer.payload.length,
          qrChars: url.length,
          gatherMs: offer.gatherMs,
          candidates: peer.candidateSummary(),
          qr: qrMetrics(q),
          url,
        };
        hs.report = rep;
        hs.rawSdp = offer.rawSdp;
        hs.ready = true;
        setQr(q);
        setReport(rep);
        if (mode === "qr") {
          setStatus("Scan this with your phone, then hold your phone's screen up to this laptop's camera.");
        } else {
          setStatus("Scan the QR, or open the phone page and type the code below. Waiting for the phone…");
          const t0 = performance.now();
          const ans = await pollSlot(hs.code as string, "answer", { intervalMs: 250 });
          if (cancelled) return;
          relayInfo.current.answerWaitMs = performance.now() - t0;
          relayInfo.current.polls = ans.polls;
          relayInfo.current.lastPollMs = ans.lastRoundTripMs;
          await submitAnswer(ans.payload);
        }
      } catch (e) {
        if (!cancelled) setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();

    hs.runPings = async (n: number) => summarize(await peer.runPings(n));
    hs.pingRaw = (n: number) => peer.runPings(n);
    hs.motionAnalysis = (sent: number) => analyzeSequence(peer.motionRx, sent);
    hs.motionSeqs = () => Array.from(new Set(peer.motionRx.map((m) => m.seq))).length;
    hs.resetMotion = () => {
      peer.motionRx.length = 0;
    };
    hs.selectedPair = () => peer.selectedPair();
    hs.whenOpen = () => peer.whenOpen();
    hs.localCandidates = () => peer.candidateSummary();
    hs.sctp = () => ({
      maxMessageSize: peer.pc.sctp?.maxMessageSize,
      state: peer.pc.connectionState,
      ice: peer.pc.iceConnectionState,
      ctrl: { ordered: peer.ctrl.ordered, maxRetransmits: peer.ctrl.maxRetransmits },
      motion: { ordered: peer.motion.ordered, maxRetransmits: peer.motion.maxRetransmits },
    });
    hs.iceServers = peer.pc.getConfiguration().iceServers ?? [];

    return () => {
      cancelled = true;
      peer.close();
    };
  }, [mode, session, submitAnswer]);

  return (
    <main style={{ padding: 24, maxWidth: 960, margin: "0 auto", fontFamily: "var(--font-mono), monospace" }}>
      <h1 style={{ fontSize: 28 }}>Handshake lab: laptop</h1>
      <p>
        WebRTC with <code>iceServers: []</code>, no signalling server in mode A, no STUN, no third party.
      </p>
      <div role="group" aria-label="Pairing mode">
        <button type="button" aria-pressed={mode === "qr"} onClick={() => setMode("qr")}>
          A: two-way QR
        </button>{" "}
        <button type="button" aria-pressed={mode === "relay"} onClick={() => setMode("relay")}>
          B: relay code
        </button>{" "}
        <button type="button" onClick={() => setSession((s) => s + 1)}>
          Restart
        </button>
      </div>
      <p aria-live="polite" data-testid="status">
        {status}
      </p>

      {qr && !connected && (
        <section aria-label="Pairing code">
          <QrCanvas qr={qr} width={320} label="Pairing QR code. Scan with your phone." />
          {mode === "relay" && (
            <p>
              Code: <strong data-testid="code">{code}</strong> (open <code>/lab/handshake/phone</code> on the phone and type it)
            </p>
          )}
        </section>
      )}

      {mode === "qr" && !connected && report && (
        <section aria-label="Scan the phone's answer">
          {scanning ? (
            <Scanner
              onAnswer={submitAnswer}
              onStats={(st) => {
                setScanStats(st);
                if (window.__hs) window.__hs.scanStats = st;
              }}
            />
          ) : (
            <button type="button" onClick={() => setScanning(true)}>
              Open camera and scan the phone
            </button>
          )}
          {scanStats && (
            <p data-testid="scan-stats">
              frames {scanStats.frames}, decode {scanStats.decodeMsAvg.toFixed(1)} ms/frame at {scanStats.videoWidth}x
              {scanStats.videoHeight}
              {scanStats.firstHitMs ? `, first hit after ${Math.round(scanStats.firstHitMs)} ms` : ""}
            </p>
          )}
          <label>
            No camera? Paste the phone&apos;s answer text{" "}
            <input value={paste} onChange={(e) => setPaste(e.target.value)} style={{ width: 280 }} />
          </label>{" "}
          <button
            type="button"
            onClick={() => {
              const t = paste.trim().toUpperCase().replace(/^HS1\./, "");
              if (t) void submitAnswer(t);
            }}
          >
            Use pasted answer
          </button>
        </section>
      )}

      {report && (
        <section aria-label="Size report">
          <h2>Offer size</h2>
          <ul data-testid="report">
            <li>raw SDP: {report.rawSdpBytes} bytes</li>
            <li>
              minified binary: {report.minPayloadBytes} bytes, base43 {report.payloadChars} chars
            </li>
            <li>QR text: {report.qrChars} chars</li>
            {report.qr && (
              <li>
                QR version {report.qr.version}, {report.qr.modules}x{report.qr.modules} modules, ECC {report.qr.ecc}, density{" "}
                {(report.qr.density * 100).toFixed(0)}%
              </li>
            )}
            <li>ICE gather: {Math.round(report.gatherMs)} ms</li>
            <li>
              candidates:{" "}
              {report.candidates.length
                ? report.candidates.map((c) => `${c.type}/${c.proto}/${c.mdns ? "mdns" : "ip"}`).join(", ")
                : "none"}
            </li>
          </ul>
        </section>
      )}

      {connected && (
        <section aria-label="Live link">
          <h2>Live</h2>
          <p data-testid="orient">
            orientation: {orient ? `${orient.a.toFixed(1)} / ${orient.b.toFixed(1)} / ${orient.g.toFixed(1)}` : "waiting for phone"}
          </p>
          <button
            type="button"
            onClick={async () => {
              const s = summarize(await peerRef.current!.runPings(200));
              setPingRes(`RTT n=${s.n} median ${s.median.toFixed(2)} ms, p95 ${s.p95.toFixed(2)} ms`);
            }}
          >
            Ping x200
          </button>
          <p aria-live="polite">{pingRes}</p>
        </section>
      )}
    </main>
  );
}
