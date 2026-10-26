import { buildSdp, minifySdp, packMin, unpackMin, type MinSdp } from "./sdp";

export interface GatherResult {
  rawSdp: string;
  min: MinSdp;
  payload: string; // base43
  gatherMs: number;
}

export interface MotionSample {
  seq: number;
  sentAt: number; // Date.now() on the sender
  recvAt: number; // Date.now() on the receiver
  recvPerf: number; // performance.now() on the receiver
}

/** One side of a no-signalling, no-STUN WebRTC pairing. Both sides use identical negotiated channels. */
export class HandshakePeer {
  readonly pc: RTCPeerConnection;
  /** reliable + ordered: pings, control */
  readonly ctrl: RTCDataChannel;
  /** unordered, no retransmit: orientation stream */
  readonly motion: RTCDataChannel;
  readonly localCandidates: string[] = [];
  readonly motionRx: MotionSample[] = [];
  connectedAt = 0;
  openAt = 0;
  private pingWaiters = new Map<number, (rtt: number) => void>();
  private pingSent = new Map<number, number>();
  private pingId = 0;
  onOpen: (() => void) | null = null;
  onMotion: ((m: { seq: number; a: number; b: number; g: number }) => void) | null = null;
  onCtrlText: ((s: string) => void) | null = null;

  constructor(iceServers: RTCIceServer[] = []) {
    this.pc = new RTCPeerConnection({ iceServers });
    this.ctrl = this.pc.createDataChannel("ctrl", { negotiated: true, id: 0 });
    this.motion = this.pc.createDataChannel("motion", {
      negotiated: true,
      id: 1,
      ordered: false,
      maxRetransmits: 0,
    });
    this.motion.binaryType = "arraybuffer";
    this.pc.addEventListener("icecandidate", (e) => {
      if (e.candidate) this.localCandidates.push(e.candidate.candidate);
    });
    this.ctrl.addEventListener("open", () => {
      this.openAt = performance.now();
      this.onOpen?.();
    });
    this.ctrl.addEventListener("message", (e) => this.onCtrl(String(e.data)));
    this.motion.addEventListener("message", (e) => this.onMotionMsg(e.data as ArrayBuffer));
  }

  private onCtrl(s: string) {
    if (s.startsWith("p:")) {
      this.ctrl.send("e:" + s.slice(2)); // echo
    } else if (s.startsWith("e:")) {
      const id = Number(s.slice(2));
      const t0 = this.pingSent.get(id);
      const w = this.pingWaiters.get(id);
      if (t0 !== undefined && w) {
        this.pingSent.delete(id);
        this.pingWaiters.delete(id);
        w(performance.now() - t0);
      }
    } else this.onCtrlText?.(s);
  }

  private onMotionMsg(buf: ArrayBuffer) {
    const dv = new DataView(buf);
    const seq = dv.getUint32(0);
    const sentAt = dv.getFloat64(4);
    const a = dv.getFloat32(12);
    const b = dv.getFloat32(16);
    const g = dv.getFloat32(20);
    this.motionRx.push({ seq, sentAt, recvAt: Date.now(), recvPerf: performance.now() });
    this.onMotion?.({ seq, a, b, g });
  }

  /** Resolves when ICE gathering is complete (or after `timeoutMs`). */
  private async gather(timeoutMs = 4000): Promise<void> {
    if (this.pc.iceGatheringState === "complete") return;
    await new Promise<void>((resolve) => {
      const done = () => {
        this.pc.removeEventListener("icegatheringstatechange", check);
        clearTimeout(t);
        resolve();
      };
      const check = () => {
        if (this.pc.iceGatheringState === "complete") done();
      };
      const t = setTimeout(done, timeoutMs);
      this.pc.addEventListener("icegatheringstatechange", check);
    });
  }

  private result(t0: number): GatherResult {
    const rawSdp = this.pc.localDescription!.sdp;
    const min = minifySdp(rawSdp);
    return { rawSdp, min, payload: packMin(min), gatherMs: performance.now() - t0 };
  }

  async createOffer(): Promise<GatherResult> {
    const t0 = performance.now();
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await this.gather();
    return this.result(t0);
  }

  /** Phone side: take the laptop's payload, produce an answer. */
  async acceptOffer(payload: string): Promise<GatherResult> {
    const t0 = performance.now();
    const min = unpackMin(payload);
    await this.pc.setRemoteDescription({ type: "offer", sdp: buildSdp(min, "offer") });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await this.gather();
    return this.result(t0);
  }

  /** Laptop side: take the phone's payload and finish. */
  async acceptAnswer(payload: string): Promise<void> {
    const min = unpackMin(payload);
    await this.pc.setRemoteDescription({ type: "answer", sdp: buildSdp(min, "answer") });
  }

  whenOpen(timeoutMs = 15000): Promise<void> {
    if (this.ctrl.readyState === "open" && this.motion.readyState === "open") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("data channel did not open")), timeoutMs);
      const check = () => {
        if (this.ctrl.readyState === "open" && this.motion.readyState === "open") {
          clearTimeout(t);
          resolve();
        }
      };
      this.ctrl.addEventListener("open", check);
      this.motion.addEventListener("open", check);
    });
  }

  ping(): Promise<number> {
    const id = ++this.pingId;
    return new Promise((resolve) => {
      this.pingWaiters.set(id, resolve);
      this.pingSent.set(id, performance.now());
      this.ctrl.send("p:" + id);
    });
  }

  async runPings(n: number): Promise<number[]> {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(await this.ping());
    return out;
  }

  sendMotion(seq: number, a: number, b: number, g: number) {
    const buf = new ArrayBuffer(24);
    const dv = new DataView(buf);
    dv.setUint32(0, seq);
    dv.setFloat64(4, Date.now());
    dv.setFloat32(12, a);
    dv.setFloat32(16, b);
    dv.setFloat32(20, g);
    this.motion.send(buf);
  }

  /** Drift-corrected fixed-rate sender. Resolves with the number sent. */
  streamMotion(hz: number, seconds: number, sample: (seq: number) => [number, number, number]): Promise<number> {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const total = Math.round(hz * seconds);
      let sent = 0;
      const tick = () => {
        const due = Math.min(total, Math.floor(((performance.now() - t0) * hz) / 1000) + 1);
        while (sent < due) {
          const [a, b, g] = sample(sent);
          this.sendMotion(sent, a, b, g);
          sent++;
        }
        if (sent >= total) resolve(sent);
        else setTimeout(tick, 2);
      };
      tick();
    });
  }

  /** Candidate types seen locally, parsed from candidate strings. */
  candidateSummary() {
    const out: { type: string; addr: string; mdns: boolean; proto: string }[] = [];
    for (const c of this.localCandidates) {
      const f = c.replace(/^candidate:/, "").split(/\s+/);
      out.push({ proto: f[2], addr: f[4], type: f[7], mdns: f[4].endsWith(".local") });
    }
    return out;
  }

  async selectedPair() {
    const stats = await this.pc.getStats();
    let pairId: string | undefined;
    stats.forEach((s) => {
      if (s.type === "transport" && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
    });
    const rep: Record<string, unknown> = {};
    stats.forEach((s) => {
      if (s.type === "candidate-pair" && (s.id === pairId || (s.selected && !pairId))) {
        rep.pair = { state: s.state, rtt: s.currentRoundTripTime };
        const l = stats.get(s.localCandidateId);
        const r = stats.get(s.remoteCandidateId);
        rep.local = l && { type: l.candidateType, address: l.address ?? l.ip, protocol: l.protocol };
        rep.remote = r && { type: r.candidateType, address: r.address ?? r.ip, protocol: r.protocol };
      }
    });
    return rep;
  }

  close() {
    try {
      this.ctrl.close();
      this.motion.close();
      this.pc.close();
    } catch {
      /* ignore */
    }
  }
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export function summarize(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0],
    median: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    max: s[s.length - 1],
    mean: s.reduce((a, b) => a + b, 0) / (s.length || 1),
  };
}

/** Sequence-gap analysis for the lossy channel. */
export function analyzeSequence(samples: MotionSample[], sent: number) {
  const seen = new Set(samples.map((s) => s.seq));
  let outOfOrder = 0;
  let maxSeq = -1;
  for (const s of samples) {
    if (s.seq < maxSeq) outOfOrder++;
    maxSeq = Math.max(maxSeq, s.seq);
  }
  const received = seen.size;
  const gaps: number[] = [];
  const sortedPerf = samples.map((s) => s.recvPerf);
  for (let i = 1; i < sortedPerf.length; i++) gaps.push(sortedPerf[i] - sortedPerf[i - 1]);
  const oneWay = samples.map((s) => s.recvAt - s.sentAt);
  return {
    sent,
    received,
    duplicates: samples.length - received,
    dropped: sent - received,
    dropRate: sent ? (sent - received) / sent : 0,
    outOfOrder,
    interArrival: gaps.length ? summarize(gaps) : null,
    oneWayMs: oneWay.length ? summarize(oneWay) : null,
  };
}
