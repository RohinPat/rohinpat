// The direct path: one WebRTC connection carrying two data channels.
//
//   reliable   (ordered)                      LinkMsg as JSON, and pings
//   unreliable (unordered, no retransmits)    orientation frames; a stale pose is worthless
//
// Signalling rides the relay, so this never needs a server of its own:
// `iceServers` is empty, which means no STUN, no TURN, no third-party request
// of any kind. Only candidates on the devices' own networks are offered, so the
// direct path exists only when the two devices can reach each other (same
// Wi-Fi, no client isolation). Otherwise the link just stays on the relay.
//
// The SDP is minified to a few dozen bytes (see sdp.ts) and sent without
// trickle: we wait for gathering, which with no servers takes milliseconds.

import { buildSdp, minifySdp, packMin, unpackMin } from "./sdp";

/** What the client needs from a direct path. The client's tests use a fake. */
export interface DirectPeer {
  /** both channels open */
  onOpen: (() => void) | null;
  /** the connection failed or closed by itself (not when we call close()) */
  onClose: ((why: string) => void) | null;
  onReliable: ((text: string) => void) | null;
  onUnreliable: ((buf: ArrayBuffer) => void) | null;
  readonly isOpen: boolean;
  /** Offerer: gather candidates and produce the packed offer. */
  createOffer(): Promise<string>;
  /** Answerer: take the packed offer, produce the packed answer. */
  acceptOffer(payload: string): Promise<string>;
  acceptAnswer(payload: string): Promise<void>;
  sendReliable(text: string): boolean;
  /** false if the frame was dropped (not open, or the channel is backed up) */
  sendUnreliable(buf: ArrayBuffer): boolean;
  close(): void;
}

/** A pose behind this many unsent bytes is already stale: skip it. */
const MAX_UNRELIABLE_BUFFER = 16 * 1024;
const GATHER_TIMEOUT_MS = 2500;
/** "disconnected" often heals; this long without healing counts as down */
const DISCONNECT_GRACE_MS = 4000;

export class RtcDirectPeer implements DirectPeer {
  onOpen: (() => void) | null = null;
  onClose: ((why: string) => void) | null = null;
  onReliable: ((text: string) => void) | null = null;
  onUnreliable: ((buf: ArrayBuffer) => void) | null = null;

  private readonly pc: RTCPeerConnection;
  private readonly rel: RTCDataChannel;
  private readonly unrel: RTCDataChannel;
  private opened = false;
  private closed = false;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.pc = new RTCPeerConnection({ iceServers: [] });
    this.rel = this.pc.createDataChannel("rel", { negotiated: true, id: 0 });
    this.unrel = this.pc.createDataChannel("unrel", { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    this.unrel.binaryType = "arraybuffer";

    const maybeOpen = () => {
      if (this.opened || this.closed) return;
      if (this.rel.readyState === "open" && this.unrel.readyState === "open") {
        this.opened = true;
        this.onOpen?.();
      }
    };
    this.rel.addEventListener("open", maybeOpen);
    this.unrel.addEventListener("open", maybeOpen);
    this.rel.addEventListener("message", (e) => {
      if (typeof e.data === "string") this.onReliable?.(e.data);
    });
    this.unrel.addEventListener("message", (e) => {
      if (e.data instanceof ArrayBuffer) this.onUnreliable?.(e.data);
    });
    this.rel.addEventListener("close", () => this.down("channel closed"));
    this.unrel.addEventListener("close", () => this.down("channel closed"));
    this.pc.addEventListener("connectionstatechange", () => {
      const s = this.pc.connectionState;
      if (s === "failed" || s === "closed") this.down(`connection ${s}`);
      else if (s === "disconnected") {
        if (!this.disconnectTimer) {
          this.disconnectTimer = setTimeout(() => {
            this.disconnectTimer = null;
            if (this.pc.connectionState === "disconnected") this.down("connection lost");
          }, DISCONNECT_GRACE_MS);
        }
      } else if (this.disconnectTimer) {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
      }
    });
  }

  get isOpen(): boolean {
    return this.opened && !this.closed && this.rel.readyState === "open" && this.unrel.readyState === "open";
  }

  private down(why: string) {
    if (this.closed) return;
    this.closeQuietly();
    this.onClose?.(why);
  }

  private closeQuietly() {
    this.closed = true;
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
    try {
      this.rel.close();
      this.unrel.close();
      this.pc.close();
    } catch {
      /* already closed */
    }
  }

  private async gather(): Promise<void> {
    const pc = this.pc;
    if (pc.iceGatheringState === "complete") return;
    await new Promise<void>((resolve) => {
      const done = () => {
        pc.removeEventListener("icegatheringstatechange", check);
        clearTimeout(t);
        resolve();
      };
      const check = () => {
        if (pc.iceGatheringState === "complete") done();
      };
      const t = setTimeout(done, GATHER_TIMEOUT_MS);
      pc.addEventListener("icegatheringstatechange", check);
    });
  }

  private packedLocal(): string {
    const d = this.pc.localDescription;
    if (!d) throw new Error("no local description");
    return packMin(minifySdp(d.sdp));
  }

  async createOffer(): Promise<string> {
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await this.gather();
    return this.packedLocal();
  }

  async acceptOffer(payload: string): Promise<string> {
    await this.pc.setRemoteDescription({ type: "offer", sdp: buildSdp(unpackMin(payload), "offer") });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await this.gather();
    return this.packedLocal();
  }

  async acceptAnswer(payload: string): Promise<void> {
    await this.pc.setRemoteDescription({ type: "answer", sdp: buildSdp(unpackMin(payload), "answer") });
  }

  sendReliable(text: string): boolean {
    if (this.closed || this.rel.readyState !== "open") return false;
    try {
      this.rel.send(text);
      return true;
    } catch {
      return false;
    }
  }

  sendUnreliable(buf: ArrayBuffer): boolean {
    if (this.closed || this.unrel.readyState !== "open") return false;
    if (this.unrel.bufferedAmount > MAX_UNRELIABLE_BUFFER) return false;
    try {
      this.unrel.send(buf);
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.closeQuietly();
  }
}

/** A real peer, or null where WebRTC is missing or blocked (the link then stays on the relay). */
export function createRtcPeer(): DirectPeer | null {
  if (typeof RTCPeerConnection === "undefined") return null;
  try {
    return new RtcDirectPeer();
  } catch {
    return null;
  }
}
