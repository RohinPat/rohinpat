// Numbers the device test has to produce: connection state and time to connect,
// which ICE candidate pair won, RTT from ctrl pings, orientation rate and loss
// from sequence numbers, and the phone's real devicemotion interval.

import { summarize, type HandshakePeer } from "@/lib/lab/handshake/peer";

// ---- small trackers (pure, unit-tested) ---------------------------------------

/** Loss from sequence numbers on an unordered, unreliable channel. */
export class SeqTracker {
  private first = -1;
  private max = -1;
  received = 0;
  outOfOrder = 0;
  add(seq: number): void {
    if (this.first < 0) this.first = seq;
    this.received++;
    if (seq < this.max) this.outOfOrder++;
    else this.max = seq;
  }
  get expected(): number {
    return this.first < 0 ? 0 : this.max - this.first + 1;
  }
  get dropped(): number {
    return Math.max(0, this.expected - this.received);
  }
  get dropRate(): number {
    return this.expected > 0 ? this.dropped / this.expected : 0;
  }
  reset(): void {
    this.first = -1;
    this.max = -1;
    this.received = 0;
    this.outOfOrder = 0;
  }
}

/**
 * Message rate. Chrome only fires deviceorientation when the angle changes, so
 * a phone held still sends nothing; `activeHz` therefore divides by the
 * seconds in which anything arrived, not by wall time.
 */
export class RateCounter {
  private stamps: number[] = [];
  private buckets = new Set<number>();
  total = 0;
  hit(nowMs: number): void {
    this.total++;
    this.stamps.push(nowMs);
    this.buckets.add(Math.floor(nowMs / 1000));
    if (this.stamps.length > 4000) this.stamps.splice(0, 1000);
  }
  /** Messages per second over the last `windowMs`. */
  recentHz(nowMs: number, windowMs = 2000): number {
    let n = 0;
    for (let i = this.stamps.length - 1; i >= 0 && this.stamps[i] >= nowMs - windowMs; i--) n++;
    return (n * 1000) / windowMs;
  }
  /** Total / seconds that saw at least one message. */
  get activeHz(): number {
    return this.buckets.size ? this.total / this.buckets.size : 0;
  }
}

export interface NumSummary {
  n: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

export function summarizeMs(xs: number[]): NumSummary | null {
  if (!xs.length) return null;
  const s = summarize(xs);
  return { n: s.n, medianMs: s.median, p95Ms: s.p95, maxMs: s.max };
}

/** Time between devicemotion events, measured on the phone with its own clock. */
export class IntervalTracker {
  private last = 0;
  private deltas: number[] = [];
  count = 0;
  /** `interval` as the browser reports it (spec: ms; some iOS versions: s). Raw, unconverted. */
  reported: number | null = null;
  add(nowMs: number, reportedInterval?: number | null): void {
    this.count++;
    if (typeof reportedInterval === "number" && Number.isFinite(reportedInterval)) this.reported = reportedInterval;
    if (this.last) {
      const d = nowMs - this.last;
      if (d > 0 && d < 1000) {
        this.deltas.push(d);
        if (this.deltas.length > 600) this.deltas.splice(0, 100);
      }
    }
    this.last = nowMs;
  }
  summary(): (NumSummary & { hz: number; reportedInterval: number | null; events: number }) | null {
    const s = summarizeMs(this.deltas);
    if (!s) return null;
    return { ...s, hz: s.medianMs > 0 ? 1000 / s.medianMs : 0, reportedInterval: this.reported, events: this.count };
  }
}

// ---- candidate pair summary ----------------------------------------------------

export type AddrKind =
  | "mdns"
  | "ipv4-private"
  | "ipv4-linklocal"
  | "ipv4-cgnat"
  | "ipv4-public"
  | "ipv6-ula"
  | "ipv6-linklocal"
  | "ipv6-global"
  | "hidden"
  | "unknown";

/** Classify without keeping the address, so a pasted results blob carries no IPs. */
export function classifyAddress(addr: unknown): AddrKind {
  if (typeof addr !== "string" || !addr) return "hidden";
  if (addr.toLowerCase().endsWith(".local")) return "mdns";
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return "ipv4-private";
    if (a === 169 && b === 254) return "ipv4-linklocal";
    if (a === 100 && b >= 64 && b <= 127) return "ipv4-cgnat";
    return "ipv4-public";
  }
  if (addr.includes(":")) {
    const l = addr.toLowerCase();
    if (l.startsWith("fe80")) return "ipv6-linklocal";
    if (l.startsWith("fc") || l.startsWith("fd")) return "ipv6-ula";
    return "ipv6-global";
  }
  return "unknown";
}

export interface CandSummary {
  type: string;
  addr: AddrKind;
  protocol: string;
}
export interface PairSummary {
  local: CandSummary | null;
  remote: CandSummary | null;
  /** currentRoundTripTime from the selected pair (STUN), ms. */
  stunRttMs: number | null;
}

const cand = (c: unknown): CandSummary | null => {
  if (!c || typeof c !== "object") return null;
  const o = c as { type?: unknown; address?: unknown; protocol?: unknown };
  return { type: String(o.type ?? "?"), addr: classifyAddress(o.address), protocol: String(o.protocol ?? "?") };
};

export function summarizePair(rep: Record<string, unknown>): PairSummary | null {
  if (!rep.pair) return null;
  const rtt = (rep.pair as { rtt?: unknown }).rtt;
  return {
    local: cand(rep.local),
    remote: cand(rep.remote),
    stunRttMs: typeof rtt === "number" ? rtt * 1000 : null,
  };
}

// ---- the live collector ----------------------------------------------------------

export interface LinkSnapshot {
  role: "laptop" | "phone";
  connectionState: string;
  iceState: string;
  /** Laptop: the answer was accepted -> channels open. Pure connection time, camera excluded. */
  answerToOpenMs: number | null;
  /** The pairing screen appeared -> channels open (includes the human aiming a QR code). */
  shownToOpenMs: number | null;
  /** Laptop: offer QR shown -> phone's answer read. */
  scanMs: number | null;
  pair: PairSummary | null;
  localCandidates: { type: string; proto: string; addr: AddrKind }[];
  rtt: (NumSummary & { lastMs: number }) | null;
  orientRx: {
    received: number;
    expected: number;
    dropped: number;
    dropRate: number;
    outOfOrder: number;
    recentHz: number;
    activeHz: number;
  };
  orientTx: { total: number; recentHz: number; activeHz: number };
  devicemotion: ReturnType<IntervalTracker["summary"]>;
  userAgent: string;
  extra: Record<string, unknown>;
}

const MAX_RTTS = 400;

export class LinkDiagnostics {
  readonly seq = new SeqTracker();
  readonly rx = new RateCounter();
  readonly tx = new RateCounter();
  readonly motionInterval = new IntervalTracker();
  rtts: number[] = [];
  pair: PairSummary | null = null;
  /** performance.now() marks. */
  marks: { shown?: number; offerReady?: number; answer?: number; open?: number } = {};
  extra: Record<string, unknown> = {};
  private peer: HandshakePeer | null = null;
  private stopped = false;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(readonly role: "laptop" | "phone") {}

  /** Start measuring a peer whose channels just opened. */
  attach(peer: HandshakePeer): void {
    this.peer = peer;
    this.marks.open ??= performance.now();
    const loop = (n: number) => {
      if (this.stopped) return;
      void this.pingOnce();
      // a quick burst so there are numbers within seconds, then one a second
      this.timers.push(setTimeout(() => loop(n + 1), n < 12 ? 150 : 1000));
    };
    loop(0);
    const pollPair = () => {
      if (this.stopped) return;
      void peer
        .selectedPair()
        .then((rep) => {
          const p = summarizePair(rep);
          if (p) this.pair = p;
        })
        .catch(() => undefined);
      this.timers.push(setTimeout(pollPair, this.pair ? 5000 : 500));
    };
    pollPair();
  }

  private async pingOnce(): Promise<void> {
    const peer = this.peer;
    if (!peer || peer.ctrl.readyState !== "open") return;
    try {
      const rtt = await Promise.race([peer.ping(), new Promise<number>((r) => setTimeout(() => r(NaN), 3000))]);
      if (Number.isFinite(rtt)) {
        this.rtts.push(rtt);
        if (this.rtts.length > MAX_RTTS) this.rtts.splice(0, this.rtts.length - MAX_RTTS);
      }
    } catch {
      /* channel closed mid-ping */
    }
  }

  stop(): void {
    this.stopped = true;
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  /**
   * getStats hides the address of a local candidate that was announced as mDNS, so "hidden" for the
   * local side plus an mDNS candidate in our own gathered list means the pair used the mDNS name.
   */
  private withLocalMdnsHint(local: { addr: AddrKind }[]): PairSummary | null {
    const p = this.pair;
    if (!p || !p.local || p.local.addr !== "hidden") return p;
    return local.some((c) => c.addr === "mdns") ? { ...p, local: { ...p.local, addr: "mdns" } } : p;
  }

  snapshot(nowMs: number = performance.now()): LinkSnapshot {
    const peer = this.peer;
    const m = this.marks;
    const s = summarizeMs(this.rtts);
    const localCandidates = peer
      ? peer.candidateSummary().map((c) => ({ type: c.type, proto: c.proto, addr: classifyAddress(c.addr) }))
      : [];
    return {
      role: this.role,
      connectionState: peer?.pc.connectionState ?? "new",
      iceState: peer?.pc.iceConnectionState ?? "new",
      answerToOpenMs: m.answer !== undefined && m.open !== undefined ? m.open - m.answer : null,
      shownToOpenMs: m.shown !== undefined && m.open !== undefined ? m.open - m.shown : null,
      scanMs: m.offerReady !== undefined && m.answer !== undefined ? m.answer - m.offerReady : null,
      pair: this.withLocalMdnsHint(localCandidates),
      localCandidates,
      rtt: s ? { ...s, lastMs: this.rtts[this.rtts.length - 1] } : null,
      orientRx: {
        received: this.seq.received,
        expected: this.seq.expected,
        dropped: this.seq.dropped,
        dropRate: this.seq.dropRate,
        outOfOrder: this.seq.outOfOrder,
        recentHz: this.rx.recentHz(nowMs),
        activeHz: this.rx.activeHz,
      },
      orientTx: { total: this.tx.total, recentHz: this.tx.recentHz(nowMs), activeHz: this.tx.activeHz },
      devicemotion: this.motionInterval.summary(),
      userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
      extra: this.extra,
    };
  }
}

// ---- the JSON Rohin pastes back -----------------------------------------------------

export interface GestureLogEntry {
  at: string;
  line: string;
  gesture: string;
}

export interface ResultsInput {
  origin: string;
  laptop: LinkSnapshot;
  phone: Record<string, unknown> | null;
  phoneHello: { ua: string; platform: string; screen: { w: number; h: number } } | null;
  clock: { rttMs: number | null; offsetMs: number | null };
  gestures: GestureLogEntry[];
  gestureRejects: number;
  failure: string | null;
}

const r1 = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

/** Rounds the noisy floats and drops nothing else. */
export function buildResults(i: ResultsInput) {
  const l = i.laptop;
  return {
    lab: "link",
    version: 1,
    at: new Date().toISOString(),
    host: (() => {
      try {
        return new URL(i.origin).host;
      } catch {
        return i.origin;
      }
    })(),
    secureContext: typeof window !== "undefined" ? window.isSecureContext : null,
    failure: i.failure,
    connection: {
      connectionState: l.connectionState,
      iceState: l.iceState,
      answerToOpenMs: r1(l.answerToOpenMs),
      scanMs: r1(l.scanMs),
      pair: l.pair && { ...l.pair, stunRttMs: r1(l.pair.stunRttMs) },
      laptopLocalCandidates: l.localCandidates,
    },
    rtt: l.rtt && { n: l.rtt.n, medianMs: r1(l.rtt.medianMs), p95Ms: r1(l.rtt.p95Ms), maxMs: r1(l.rtt.maxMs) },
    orientation: {
      received: l.orientRx.received,
      expected: l.orientRx.expected,
      dropRatePct: r1(l.orientRx.dropRate * 100),
      outOfOrder: l.orientRx.outOfOrder,
      activeHz: r1(l.orientRx.activeHz),
    },
    clockSync: i.clock,
    laptop: { userAgent: l.userAgent },
    phone: i.phone,
    phoneHello: i.phoneHello,
    gestures: { received: i.gestures, rejected: i.gestureRejects },
  };
}

/** Shared by both sides so a number never reads two ways. */
export const fmtMs = (n: number | null | undefined, d = 1) => (typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(d)} ms` : "-");
export const fmtPct = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "-");
export const fmtHz = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(0)} Hz` : "-");
export const fmtPair = (p: PairSummary | null) =>
  p
    ? `${p.local?.type ?? "?"}/${p.local?.addr ?? "?"} <-> ${p.remote?.type ?? "?"}/${p.remote?.addr ?? "?"} (${p.local?.protocol ?? "?"})`
    : "-";
