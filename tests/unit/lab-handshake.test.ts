import { describe, expect, it } from "vitest";
import fs from "node:fs";
import zlib from "node:zlib";
import jsQR from "jsqr";
import {
  B43,
  buildSdp,
  decodeMin,
  encodeMin,
  fromBase43,
  minifySdp,
  packMin,
  toBase43,
  unpackMin,
} from "@/lib/lab/handshake/sdp";
import { answerQr, makeQr, offerQr, parseAnswerText, parseFragment, qrMetrics } from "@/lib/lab/handshake/qr";
import { downscale2, renderFrame } from "@/lib/lab/handshake/sim";
import { analyzeSequence, percentile } from "@/lib/lab/handshake/peer";

// What Chrome emits for a single data channel, with a camera-permitted host
// candidate set (real IPs), plus an mDNS one and an IPv6 one.
const CHROME_OFFER = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "a=extmap-allow-mixed",
  "a=msid-semantic: WMS",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=candidate:2999745851 1 udp 2122260223 192.168.86.24 55071 typ host generation 0 network-id 1 network-cost 10",
  "a=candidate:1853887674 1 udp 2122194687 10.0.0.7 51202 typ host generation 0 network-id 2 network-cost 10",
  "a=candidate:3510621330 1 udp 2122129151 2601:19b:c80:1a10:6d2c:ae3:4c8:f1a1 63120 typ host generation 0 network-id 3 network-cost 10",
  "a=candidate:1111111111 1 udp 2113937151 5f1c2a6e-0d9b-4a11-8c3a-9a1b2c3d4e5f.local 61012 typ host generation 0 network-id 1 network-cost 10",
  "a=candidate:2222222222 1 tcp 1518280447 192.168.86.24 9 typ host tcptype active generation 0 network-id 1 network-cost 10",
  "a=ice-ufrag:Zq3k",
  "a=ice-pwd:8cS0n2p1VwQeR7yTz3uXb4Hf",
  "a=ice-options:trickle",
  "a=fingerprint:sha-256 4A:1C:7F:00:93:BB:2D:E1:5E:60:11:9C:AA:73:0D:42:F8:19:6B:C4:3E:57:D2:81:0A:99:6F:B3:25:CE:78:D4",
  "a=setup:actpass",
  "a=mid:0",
  "a=sctp-port:5000",
  "a=max-message-size:262144",
  "",
].join("\r\n");

describe("sdp minify", () => {
  it("keeps udp host candidates and drops tcp", () => {
    const m = minifySdp(CHROME_OFFER);
    expect(m.ufrag).toBe("Zq3k");
    expect(m.pwd).toBe("8cS0n2p1VwQeR7yTz3uXb4Hf");
    expect(m.fingerprint).toHaveLength(32);
    expect(m.candidates.map((c) => c.kind)).toEqual(["v4", "v4", "v6", "mdns"]);
  });

  it("round-trips through binary and base43", () => {
    const m = minifySdp(CHROME_OFFER);
    const back = unpackMin(packMin(m));
    expect(back.ufrag).toBe(m.ufrag);
    expect(back.pwd).toBe(m.pwd);
    expect(Array.from(back.fingerprint)).toEqual(Array.from(m.fingerprint));
    expect(back.candidates).toEqual(m.candidates);
  });

  it("rebuilds a SDP that minifies to the same thing", () => {
    const m = minifySdp(CHROME_OFFER);
    const rebuilt = buildSdp(m, "offer");
    expect(rebuilt).toContain("a=setup:actpass");
    expect(buildSdp(m, "answer")).toContain("a=setup:active");
    const again = minifySdp(rebuilt);
    expect(again.candidates).toEqual(m.candidates);
    expect(again.pwd).toBe(m.pwd);
  });

  it("falls back to ascii for non-base64 ufrag and handles long strings", () => {
    const m = minifySdp(CHROME_OFFER);
    m.ufrag = "ab-cd_ef";
    expect(decodeMin(encodeMin(m)).ufrag).toBe("ab-cd_ef");
  });

  it("base43 round-trips odd and even lengths and stays in the QR alphanumeric set", () => {
    for (const n of [0, 1, 2, 3, 17, 64, 99]) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
      const s = toBase43(b);
      expect(Array.from(fromBase43(s))).toEqual(Array.from(b));
      expect(Array.from(s).every((ch) => B43.includes(ch))).toBe(true);
    }
    expect(Array.from(fromBase43(toBase43(Uint8Array.from([255, 255]))))).toEqual([255, 255]);
  });

  it("rejects garbage", () => {
    expect(() => fromBase43("abc")).toThrow();
    expect(() => unpackMin("ZZZ")).toThrow();
  });
});

describe("sizes", () => {
  const m = minifySdp(CHROME_OFFER);
  it("is far smaller than raw SDP", () => {
    const payload = packMin(m);
    expect(payload.length).toBeLessThan(CHROME_OFFER.length / 3);
  });
  it("offer URL QR stays small", () => {
    const q = offerQr("https://rohinpat.vercel.app", packMin(m), "L", "/p");
    expect(q.version).toBeLessThanOrEqual(8);
  });
  it("parses fragments without decoding the + and : characters", () => {
    expect(parseFragment("#o=AB+C:D/E$F*G-H.I")).toEqual({ o: "AB+C:D/E$F*G-H.I" });
    expect(parseAnswerText("hs1.ABC")).toBe("ABC");
    expect(parseAnswerText("nope")).toBeNull();
  });
});

describe("sequence analysis", () => {
  it("counts drops, duplicates and reordering", () => {
    const mk = (seq: number) => ({ seq, sentAt: 0, recvAt: 1, recvPerf: seq });
    const a = analyzeSequence([mk(0), mk(2), mk(1), mk(2), mk(5)], 6);
    expect(a.received).toBe(4);
    expect(a.dropped).toBe(2);
    expect(a.duplicates).toBe(1);
    expect(a.outOfOrder).toBe(1);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
  });
});

describe("QR through a simulated webcam", () => {
  const m = minifySdp(CHROME_OFFER);
  const answer = answerQr(packMin(m));
  const offer = offerQr("https://rohinpat.vercel.app", packMin(m), "L", "/p");

  type Frame = { data: Uint8ClampedArray; width: number; height: number };
  const tryDecode = (f: Frame) => jsQR(f.data, f.width, f.height, { inversionAttempts: "dontInvert" });

  /** multi = also try 2x and 4x downscaled copies, as the Scanner does */
  function decodes(q: typeof answer, o: Parameters<typeof renderFrame>[1], multi = false) {
    const f = renderFrame(q, o);
    let hit = tryDecode(f);
    if (!hit && multi && f.width >= 320) {
      const h = downscale2(f);
      hit = tryDecode(h) ?? (h.width >= 160 ? tryDecode(downscale2(h)) : null);
    }
    return { ok: !!hit, text: hit?.data, px: f.pxPerModule };
  }

  it("decodes the answer QR cleanly at 320x240", () => {
    const r = decodes(answer, { width: 320, height: 240, fill: 0.9 });
    expect(r.ok).toBe(true);
    expect(r.text?.startsWith("HS1.")).toBe(true);
  });

  it("decodes the offer QR cleanly at 640x480", () => {
    const r = decodes(offer, { width: 640, height: 480, fill: 0.9 });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("#o=");
  });

  it("optional sweep writes a JSON matrix when HS_SWEEP_OUT is set", () => {
    const out = process.env.HS_SWEEP_OUT;
    if (!out) return;
    const rows: Record<string, unknown>[] = [];
    const codes = { answer, offer, answerM: answerQr(packMin(m), "M"), answerQ: answerQr(packMin(m), "Q") };
    const sizes: [number, number][] = [
      [160, 120],
      [320, 240],
      [640, 480],
    ];
    const fills = [0.3, 0.45, 0.6, 0.8, 0.95];
    const conds = [
      { name: "clean", angleDeg: 0, blur: 0, noise: 0, contrast: 1 },
      { name: "tilt12", angleDeg: 12, blur: 0, noise: 0, contrast: 1 },
      { name: "screen", angleDeg: 6, blur: 1, noise: 3, contrast: 0.6 },
      { name: "lowlight", angleDeg: 6, blur: 1, noise: 8, contrast: 0.5 },
      { name: "rough", angleDeg: 15, blur: 2, noise: 12, contrast: 0.4 },
    ];
    for (const [name, q] of Object.entries(codes)) {
      const met = qrMetrics(q);
      for (const [w, h] of sizes)
        for (const fill of fills)
          for (const c of conds) {
            let ok = 0;
            let okMulti = 0;
            const trials = 5;
            let px = 0;
            for (let s = 0; s < trials; s++) {
              const r = decodes(q, {
                width: w,
                height: h,
                fill,
                angleDeg: c.angleDeg + (s - 2) * 1.5,
                blur: c.blur,
                noise: c.noise,
                contrast: c.contrast,
                offsetX: (s - 2) * 0.01,
                seed: s + 1,
              });
              if (r.ok) ok++;
              px = r.px;
              const rm = decodes(q, { width: w, height: h, fill, angleDeg: c.angleDeg + (s - 2) * 1.5, blur: c.blur, noise: c.noise, contrast: c.contrast, offsetX: (s - 2) * 0.01, seed: s + 1 }, true);
              if (rm.ok) okMulti++;
            }
            rows.push({ code: name, version: met.version, modules: met.modules, w, h, fill, cond: c.name, pxPerModule: +px.toFixed(2), ok, okMulti, trials });
          }
    }
    fs.writeFileSync(out, JSON.stringify(rows, null, 1));
    expect(rows.length).toBeGreaterThan(0);
  }, 600000);
});

describe("size analysis (needs HS_SIZES_IN / HS_SIZES_OUT)", () => {
  it("compares encodings of real captured SDPs", () => {
    const inDir = process.env.HS_SIZES_IN;
    const out = process.env.HS_SIZES_OUT;
    if (!inDir || !out) return;
    const rows: Record<string, unknown>[] = [];
    const synth = (cands: { kind: "v4" | "v6" | "mdns"; addr: string; port: number }[]) => {
      const m = minifySdp(CHROME_OFFER);
      m.candidates = cands.map((c) => ({ ...c, type: 0 }));
      return m;
    };
    const scenarios: Record<string, { raw: string; min: ReturnType<typeof minifySdp> }> = {};
    for (const v of ["default", "no-mdns"]) {
      const j = JSON.parse(fs.readFileSync(`${inDir}/qr-${v}.json`, "utf8"));
      scenarios[`captured offer (${v})`] = { raw: j.rawSdp, min: minifySdp(j.rawSdp) };
      scenarios[`captured answer (${v})`] = { raw: j.rawAnswer, min: minifySdp(j.rawAnswer) };
    }
    scenarios["synthetic busy laptop (3x v4, 2x v6, 1 mdns)"] = {
      raw: CHROME_OFFER,
      min: synth([
        { kind: "v4", addr: "192.168.1.20", port: 50001 },
        { kind: "v4", addr: "10.8.0.2", port: 50002 },
        { kind: "v4", addr: "172.20.144.1", port: 50003 },
        { kind: "v6", addr: "2601:19b:c80:1a10:6d2c:ae3:4c8:f1a1", port: 50004 },
        { kind: "v6", addr: "2601:19b:c80:1a10:1:2:3:4", port: 50005 },
        { kind: "mdns", addr: "5f1c2a6e-0d9b-4a11-8c3a-9a1b2c3d4e5f.local", port: 50006 },
      ]),
    };
    const prod = "https://rohinpat.vercel.app";
    for (const [name, { raw, min }] of Object.entries(scenarios)) {
      const bin = encodeMin(min);
      const payload = packMin(min);
      const b64url = Buffer.from(bin).toString("base64url");
      const deflated = zlib.deflateRawSync(Buffer.from(raw), { level: 9 });
      const isOffer = name.includes("offer") || name.includes("synthetic");
      const variants: Record<string, () => ReturnType<typeof makeQr>> = {
        "raw SDP, byte mode": () => makeQr([{ data: raw, mode: "Byte" }], "L"),
        "raw SDP deflated + base64url, byte mode": () => makeQr([{ data: deflated.toString("base64url"), mode: "Byte" }], "L"),
        "minified binary + base64url, byte mode": () => makeQr([{ data: b64url, mode: "Byte" }], "L"),
        "minified binary + base43, alphanumeric (ours)": () => (isOffer ? makeQr([{ data: payload, mode: "Alphanumeric" }], "L") : answerQr(payload, "L")),
      };
      for (const [vn, f] of Object.entries(variants)) {
        const q = f();
        const mt = qrMetrics(q);
        rows.push({ scenario: name, encoding: vn, rawBytes: raw.length, binBytes: bin.length, payloadChars: payload.length, version: mt.version, modules: mt.modules, density: +mt.density.toFixed(3) });
      }
      if (isOffer) {
        for (const ecc of ["L", "M", "Q"] as const) {
          for (const [label, origin, p] of [
            ["prod /p", prod, "/p"],
            ["prod /lab/handshake/phone", prod, "/lab/handshake/phone"],
          ] as const) {
            const q = offerQr(origin, payload, ecc, p);
            rows.push({ scenario: name, encoding: `URL ${label} + payload, ECC ${ecc}`, version: q.version, modules: q.size, density: +qrMetrics(q).density.toFixed(3) });
          }
        }
      } else {
        for (const ecc of ["L", "M", "Q"] as const) {
          const q = answerQr(payload, ecc);
          rows.push({ scenario: name, encoding: `answer ECC ${ecc}`, version: q.version, modules: q.size, density: +qrMetrics(q).density.toFixed(3) });
        }
      }
    }
    fs.writeFileSync(out, JSON.stringify(rows, null, 1));
  });
});
