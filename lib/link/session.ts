// The phone link's contract. The laptop hosts a session and shows a code (a
// QR of `pairUrl`); the visitor's real phone joins it. Underneath, messages
// go through the first-party relay (a Vercel WebSocket) and move to a direct
// WebRTC channel when the two devices can reach each other, falling back to
// the relay if that drops. The UI only ever talks to this interface, so it
// doesn't care which path is carrying it.
//
// Nothing here is stored on the visitor's device, and the relay forgets a
// code once both sides leave or after two minutes unpaired.

export type Role = "host" | "phone";

export type LinkState =
  /** host: code issued, waiting for a phone to scan it */
  | "waiting"
  /** both sides on the relay, direct upgrade not settled yet */
  | "connecting"
  /** paired; `path` says which way messages are going */
  | "live"
  /** the other side went quiet; reconnecting on its own */
  | "reconnecting"
  /** gave up (bad code, expired, closed by the other side) */
  | "closed";

export type LinkPath = "direct" | "relay";

/** A pose sample from the phone. Sent often; losing one is fine. */
export type Orient = { seq: number; t: number; alpha: number; beta: number; gamma: number; screenAngle: number };

/** Everything else. Sent rarely; each must arrive. */
export type LinkMsg =
  | { type: "hello"; role: Role; ua: string; motion: "granted" | "denied" | "not-needed" | "unavailable" }
  /** phone: swipe-up progress 0..1 while the finger is down, then unlock */
  | { type: "drag"; p: number }
  | { type: "unlock" }
  | { type: "lock" }
  /** phone: a tap at a fraction of its screen, 0..1 */
  | { type: "tap"; x: number; y: number }
  /** phone: open a home-screen app by id (apps.tsx), as if tapped */
  | { type: "open"; app: string }
  /** host: which screen the big phone is on, so the phone can show the right controls */
  | { type: "screen"; name: "lock" | "home" | "piece"; piece?: string }
  | { type: "recenter" }
  /** phone -> host: a finished gesture from the active game's recogniser */
  | { type: "gesture"; name: string; data: Record<string, number | string | boolean> }
  /** continuous controls (tilt steer, twist), -1..1 or radians, a few times a second */
  | { type: "axis"; name: string; v: number }
  | { type: "bye" };

export type LinkStats = { path: LinkPath | null; rttMs: number | null; orientHz: number; lossPct: number };

export interface LinkSession {
  readonly role: Role;
  readonly state: LinkState;
  readonly path: LinkPath | null;
  /** host only: short code and the URL its QR encodes */
  readonly code: string | null;
  readonly pairUrl: string | null;
  stats(): LinkStats;
  send(msg: LinkMsg): void;
  sendOrient(o: Orient): void;
  onMessage(cb: (msg: LinkMsg) => void): () => void;
  onOrient(cb: (o: Orient) => void): () => void;
  onState(cb: (state: LinkState, path: LinkPath | null) => void): () => void;
  close(): void;
}
