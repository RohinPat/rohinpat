// SDP minification for a data-channel-only WebRTC session with no trickle.
//
// A browser's offer for one data channel is ~500 bytes of text, but only four
// things in it are not boilerplate: ice-ufrag, ice-pwd, the DTLS fingerprint,
// and the candidate list. This module pulls those out, packs them into a few
// dozen bytes, and rebuilds a full SDP on the other side.

export type CandKind = "v4" | "v6" | "mdns" | "other";

export interface MinCandidate {
  kind: CandKind;
  /** Dotted quad / IPv6 text / "<uuid>.local" / free text for "other". */
  addr: string;
  port: number;
  /** 0 host, 1 srflx, 2 prflx, 3 relay */
  type: number;
}

export interface MinSdp {
  ufrag: string;
  pwd: string;
  /** SHA-256 fingerprint, 32 bytes. */
  fingerprint: Uint8Array;
  candidates: MinCandidate[];
}

const TYPE_NAMES = ["host", "srflx", "prflx", "relay"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local$/i;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

export function parseIPv4(s: string): Uint8Array | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const n = Number(m[i + 1]);
    if (n > 255) return null;
    out[i] = n;
  }
  return out;
}

export function parseIPv6(s: string): Uint8Array | null {
  if (!s.includes(":") || s.includes("%")) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-f]{1,4}$/i.test(groups[i])) return null;
    const n = parseInt(groups[i], 16);
    out[i * 2] = n >> 8;
    out[i * 2 + 1] = n & 255;
  }
  return out;
}

export function formatIPv6(b: Uint8Array): string {
  const g: string[] = [];
  for (let i = 0; i < 16; i += 2) g.push(((b[i] << 8) | b[i + 1]).toString(16));
  return g.join(":");
}

/** Pull the essentials out of a full SDP. Throws if there is no usable data. */
export function minifySdp(sdp: string): MinSdp {
  const lines = sdp.split(/\r?\n/);
  let ufrag = "";
  let pwd = "";
  let fp: Uint8Array | null = null;
  const candidates: MinCandidate[] = [];
  for (const line of lines) {
    if (line.startsWith("a=ice-ufrag:")) ufrag = line.slice(12).trim();
    else if (line.startsWith("a=ice-pwd:")) pwd = line.slice(10).trim();
    else if (line.startsWith("a=fingerprint:") && !fp) {
      const [alg, hex] = line.slice(14).trim().split(" ");
      if (alg.toLowerCase() !== "sha-256") throw new Error(`unsupported fingerprint ${alg}`);
      fp = hexToBytes(hex.replace(/:/g, ""));
    } else if (line.startsWith("a=candidate:")) {
      // foundation component proto priority addr port typ <type> ...
      const f = line.slice(12).trim().split(/\s+/);
      if (f[1] !== "1" || f[2].toLowerCase() !== "udp" || f[6] !== "typ") continue;
      const addr = f[4];
      const port = Number(f[5]);
      const type = Math.max(0, TYPE_NAMES.indexOf(f[7]));
      let kind: CandKind;
      if (parseIPv4(addr)) kind = "v4";
      else if (addr.toLowerCase().startsWith("fe80:")) continue; // link-local needs a zone id
      else if (parseIPv6(addr)) kind = "v6";
      else if (UUID_RE.test(addr)) kind = "mdns";
      else kind = "other";
      candidates.push({ kind, addr, port, type });
    }
  }
  if (!ufrag || !pwd || !fp || fp.length !== 32) throw new Error("SDP missing ice/dtls fields");
  return { ufrag, pwd, fingerprint: fp, candidates };
}

/** Rebuild a complete data-channel SDP. role "offer" -> setup:actpass, "answer" -> setup:active. */
export function buildSdp(min: MinSdp, role: "offer" | "answer"): string {
  const fp = Array.from(min.fingerprint)
    .map((x) => x.toString(16).padStart(2, "0").toUpperCase())
    .join(":");
  const lines = [
    "v=0",
    "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    `a=ice-ufrag:${min.ufrag}`,
    `a=ice-pwd:${min.pwd}`,
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${role === "offer" ? "actpass" : "active"}`,
    "a=mid:0",
    "a=sctp-port:5000",
    "a=max-message-size:262144",
  ];
  min.candidates.forEach((c, i) => {
    // host/udp/component-1 priority: type preference 126, descending local preference
    const prio = 126 * 16777216 + (65535 - i) * 256 + 255;
    lines.push(
      `a=candidate:${i + 1} 1 udp ${prio} ${c.addr} ${c.port} typ ${TYPE_NAMES[c.type] ?? "host"} generation 0`,
    );
  });
  lines.push("a=end-of-candidates");
  return lines.join("\r\n") + "\r\n";
}

// ---- binary packing --------------------------------------------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function packString(s: string, out: number[]) {
  const sixBit = s.length < 128 && Array.from(s).every((ch) => B64.includes(ch));
  if (sixBit) {
    out.push(0x80 | s.length);
    let acc = 0;
    let bits = 0;
    for (let k = 0; k < s.length; k++) {
      acc = (acc << 6) | B64.indexOf(s[k]);
      bits += 6;
      while (bits >= 8) {
        bits -= 8;
        out.push((acc >> bits) & 255);
      }
      acc &= (1 << bits) - 1;
    }
    if (bits > 0) out.push((acc << (8 - bits)) & 255);
  } else {
    if (s.length > 127) throw new Error("string too long");
    out.push(s.length);
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 255);
  }
}

function unpackString(b: Uint8Array, pos: { i: number }): string {
  const head = b[pos.i++];
  const len = head & 0x7f;
  let s = "";
  if (head & 0x80) {
    let acc = 0;
    let bits = 0;
    while (s.length < len) {
      acc = (acc << 8) | b[pos.i++];
      bits += 8;
      while (bits >= 6 && s.length < len) {
        bits -= 6;
        s += B64[(acc >> bits) & 63];
      }
      acc &= (1 << bits) - 1;
    }
  } else {
    for (let k = 0; k < len; k++) s += String.fromCharCode(b[pos.i++]);
  }
  return s;
}

function pushAll(out: number[], b: Uint8Array) {
  for (let k = 0; k < b.length; k++) out.push(b[k]);
}

const KIND_CODE: Record<CandKind, number> = { v4: 0, v6: 1, mdns: 2, other: 3 };
const CODE_KIND: CandKind[] = ["v4", "v6", "mdns", "other"];

/** Format v1: [ver] [ufrag] [pwd] [fp x32] [n] n x ([kind|type<<2] [addr] [port16]). */
export function encodeMin(min: MinSdp): Uint8Array {
  const out: number[] = [1];
  packString(min.ufrag, out);
  packString(min.pwd, out);
  for (let k = 0; k < min.fingerprint.length; k++) out.push(min.fingerprint[k]);
  const cands = min.candidates.slice(0, 15);
  out.push(cands.length);
  for (const c of cands) {
    out.push(KIND_CODE[c.kind] | (c.type << 2));
    if (c.kind === "v4") pushAll(out, parseIPv4(c.addr)!);
    else if (c.kind === "v6") pushAll(out, parseIPv6(c.addr)!);
    else if (c.kind === "mdns") pushAll(out, hexToBytes(c.addr.replace(/\.local$/i, "").replace(/-/g, "")));
    else {
      out.push(c.addr.length);
      for (let i = 0; i < c.addr.length; i++) out.push(c.addr.charCodeAt(i) & 255);
    }
    out.push(c.port >> 8, c.port & 255);
  }
  return Uint8Array.from(out);
}

export function decodeMin(b: Uint8Array): MinSdp {
  if (b[0] !== 1) throw new Error("unknown handshake format");
  const pos = { i: 1 };
  const ufrag = unpackString(b, pos);
  const pwd = unpackString(b, pos);
  const fingerprint = b.slice(pos.i, pos.i + 32);
  pos.i += 32;
  const n = b[pos.i++];
  const candidates: MinCandidate[] = [];
  for (let k = 0; k < n; k++) {
    const head = b[pos.i++];
    const kind = CODE_KIND[head & 3];
    const type = head >> 2;
    let addr: string;
    if (kind === "v4") {
      addr = Array.from(b.slice(pos.i, pos.i + 4)).join(".");
      pos.i += 4;
    } else if (kind === "v6") {
      addr = formatIPv6(b.slice(pos.i, pos.i + 16));
      pos.i += 16;
    } else if (kind === "mdns") {
      const h = bytesToHex(b.slice(pos.i, pos.i + 16));
      pos.i += 16;
      addr = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`;
    } else {
      const len = b[pos.i++];
      addr = String.fromCharCode.apply(null, Array.from(b.slice(pos.i, pos.i + len)));
      pos.i += len;
    }
    const port = (b[pos.i] << 8) | b[pos.i + 1];
    pos.i += 2;
    candidates.push({ kind, addr, port, type });
  }
  if (pos.i > b.length) throw new Error("truncated handshake payload");
  return { ufrag, pwd, fingerprint, candidates };
}

// ---- base43: 3 chars per 2 bytes, all of them in the QR alphanumeric set ----

export const B43 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-./:";

export function toBase43(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 2) {
    if (i + 1 < b.length) {
      let n = (b[i] << 8) | b[i + 1];
      const c0 = n % 43;
      n = (n - c0) / 43;
      const c1 = n % 43;
      const c2 = (n - c1) / 43;
      s += B43[c0] + B43[c1] + B43[c2];
    } else {
      const n = b[i];
      s += B43[n % 43] + B43[Math.floor(n / 43)];
    }
  }
  return s;
}

export function fromBase43(s: string): Uint8Array {
  const out: number[] = [];
  const idx = (ch: string) => {
    const v = B43.indexOf(ch);
    if (v < 0) throw new Error("bad character in handshake code");
    return v;
  };
  for (let i = 0; i < s.length; ) {
    const left = s.length - i;
    if (left >= 3) {
      const n = idx(s[i]) + idx(s[i + 1]) * 43 + idx(s[i + 2]) * 1849;
      if (n > 65535) throw new Error("bad handshake code");
      out.push(n >> 8, n & 255);
      i += 3;
    } else if (left === 2) {
      out.push(idx(s[i]) + idx(s[i + 1]) * 43);
      i += 2;
    } else throw new Error("bad handshake code length");
  }
  return Uint8Array.from(out);
}

export function packMin(min: MinSdp): string {
  return toBase43(encodeMin(min));
}

export function unpackMin(code: string): MinSdp {
  return decodeMin(fromBase43(code.trim().toUpperCase()));
}
