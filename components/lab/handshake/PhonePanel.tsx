"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QrCanvas from "./QrCanvas";
import { HandshakePeer, summarize } from "@/lib/lab/handshake/peer";
import { answerQr, parseFragment, qrMetrics, type QrMatrix, type QrMetrics } from "@/lib/lab/handshake/qr";
import { getSlot, postSlot } from "@/lib/lab/handshake/relay";

interface PhoneReport {
  rawSdpBytes: number;
  payloadChars: number;
  gatherMs: number;
  qr: QrMetrics | null;
  candidates: ReturnType<HandshakePeer["candidateSummary"]>;
}

type DOEWithPermission = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };

export default function PhonePanel() {
  const [status, setStatus] = useState("Reading the pairing code…");
  const [qr, setQr] = useState<QrMatrix | null>(null);
  const [qrWidth, setQrWidth] = useState(320);
  const [connected, setConnected] = useState(false);
  const [needCode, setNeedCode] = useState(false);
  const [typed, setTyped] = useState("");
  const [sending, setSending] = useState(false);
  const [report, setReport] = useState<PhoneReport | null>(null);
  const peerRef = useRef<HandshakePeer | null>(null);
  const latest = useRef({ a: 0, b: 0, g: 0, real: false });
  const hsRef = useRef<Record<string, unknown>>({});

  const pairFromOffer = useCallback(async (peer: HandshakePeer, payload: string, viaRelayCode?: string) => {
    try {
      setStatus("Building your answer…");
      const ans = await peer.acceptOffer(payload);
      const q = answerQr(ans.payload);
      hsRef.current.answerPayload = ans.payload;
      const rep: PhoneReport = {
        rawSdpBytes: ans.rawSdp.length,
        payloadChars: ans.payload.length,
        gatherMs: ans.gatherMs,
        qr: qrMetrics(q),
        candidates: peer.candidateSummary(),
      };
      hsRef.current.report = rep;
      setReport(rep);
      if (viaRelayCode) {
        const t0 = performance.now();
        await postSlot(viaRelayCode, "answer", ans.payload);
        hsRef.current.postAnswerMs = performance.now() - t0;
        setStatus("Answer sent. Connecting to your laptop…");
      } else {
        setQr(q);
        setStatus("Hold this up to your laptop's camera");
      }
      hsRef.current.answered = true;
    } catch (e) {
      if (peerRef.current === peer) setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const start = useCallback(
    async (peer: HandshakePeer, hash: string) => {
      const frag = parseFragment(hash);
      if (frag.o) {
        await pairFromOffer(peer, frag.o);
      } else if (frag.c) {
        const t0 = performance.now();
        const r = await getSlot(frag.c, "offer");
        hsRef.current.getOfferMs = performance.now() - t0;
        if (peerRef.current !== peer) return;
        if (!r.value) {
          setStatus("That code was not found or has expired.");
          setNeedCode(true);
          return;
        }
        await pairFromOffer(peer, r.value, frag.c);
      } else {
        setNeedCode(true);
        setStatus("Type the code shown on your laptop.");
      }
    },
    [pairFromOffer],
  );

  useEffect(() => {
    if (typeof RTCPeerConnection === "undefined") {
      setStatus("This browser has no WebRTC (RTCPeerConnection), so peer-to-peer pairing is unavailable.");
      return;
    }
    const peer = new HandshakePeer([]);
    peerRef.current = peer;
    const hs = hsRef.current;
    Object.assign(hs, { role: "phone", peer, ready: true });
    window.__hs = hs;
    peer.onOpen = () => {
      setConnected(true);
      setQr(null);
      setStatus("Connected to your laptop.");
    };
    hs.startMotion = (hz: number, seconds: number) =>
      peer.streamMotion(hz, seconds, (seq) => {
        const t = seq / hz;
        return [(t * 30) % 360, Math.sin(t * 2) * 45, Math.cos(t * 3) * 30];
      });
    hs.blast = async (n: number) => {
      for (let i = 0; i < n; i++) peer.sendMotion(i, 0, 0, 0);
      return n;
    };
    // overload test: n messages of `bytes` each as fast as send() accepts them
    hs.blastBig = (n: number, bytes: number) => {
      let sent = 0;
      let threw = 0;
      for (let i = 0; i < n; i++) {
        const buf = new ArrayBuffer(bytes);
        new DataView(buf).setUint32(0, i);
        try {
          peer.motion.send(buf);
          sent++;
        } catch {
          threw++;
        }
      }
      return { attempted: n, accepted: sent, threw, bufferedAmount: peer.motion.bufferedAmount };
    };
    hs.selectedPair = () => peer.selectedPair();
    hs.whenOpen = () => peer.whenOpen();
    hs.localCandidates = () => peer.candidateSummary();
    hs.runPings = async (n: number) => summarize(await peer.runPings(n));
    setQrWidth(Math.min(560, Math.max(240, window.innerWidth - 32)));
    void start(peer, window.location.hash);
    const onOri = (e: DeviceOrientationEvent) => {
      latest.current = { a: e.alpha ?? 0, b: e.beta ?? 0, g: e.gamma ?? 0, real: true };
    };
    window.addEventListener("deviceorientation", onOri);
    return () => {
      window.removeEventListener("deviceorientation", onOri);
      peer.close();
    };
  }, [start]);

  async function startTilt() {
    const peer = peerRef.current!;
    const DOE = (typeof DeviceOrientationEvent !== "undefined" ? DeviceOrientationEvent : undefined) as DOEWithPermission | undefined;
    if (DOE?.requestPermission) {
      const res = await DOE.requestPermission(); // must be inside this tap on iOS
      if (res !== "granted") {
        setStatus("Motion permission denied.");
        return;
      }
    }
    setSending(true);
    setStatus("Sending orientation at 60 Hz…");
    const t0 = performance.now();
    let seq = 0;
    const id = setInterval(() => {
      if (peer.motion.readyState !== "open") return;
      const l = latest.current;
      const t = (performance.now() - t0) / 1000;
      // fall back to a synthetic wobble when the device has no orientation sensor (desktop)
      if (l.real) peer.sendMotion(seq++, l.a, l.b, l.g);
      else peer.sendMotion(seq++, (t * 30) % 360, Math.sin(t * 2) * 45, Math.cos(t * 3) * 30);
    }, 1000 / 60);
    hsRef.current.stopTilt = () => clearInterval(id);
  }

  return (
    <main style={{ padding: 16, maxWidth: 640, margin: "0 auto", fontFamily: "var(--font-mono), monospace" }}>
      <h1 style={{ fontSize: 28 }}>Handshake lab: phone</h1>
      <p aria-live="polite" data-testid="status" style={{ fontSize: qr ? 22 : 16 }}>
        {status}
      </p>
      {needCode && !qr && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            window.location.hash = `c=${typed.trim().toUpperCase()}`;
            void start(peerRef.current!, `#c=${typed.trim().toUpperCase()}`);
          }}
        >
          <label>
            Code <input value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={8} autoCapitalize="characters" />
          </label>{" "}
          <button type="submit">Pair</button>
        </form>
      )}
      {qr && !connected && <QrCanvas qr={qr} width={qrWidth} label="Answer QR code. Hold it up to your laptop's camera." />}
      {report && (
        <ul data-testid="phone-report">
          <li>raw SDP {report.rawSdpBytes} bytes, payload {report.payloadChars} chars</li>
          <li>
            answer QR v{report.qr?.version}, {report.qr?.modules}x{report.qr?.modules}, ECC {report.qr?.ecc}
          </li>
          <li>gather {Math.round(report.gatherMs)} ms</li>
          <li>candidates: {report.candidates.map((c) => `${c.type}/${c.mdns ? "mdns" : "ip"}`).join(", ") || "none"}</li>
        </ul>
      )}
      {connected && !sending && (
        <button type="button" onClick={startTilt}>
          Start sending tilt
        </button>
      )}
    </main>
  );
}
