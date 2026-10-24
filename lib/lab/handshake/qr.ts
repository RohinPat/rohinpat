import qrcode from "qrcode-generator";

export type Ecc = "L" | "M" | "Q" | "H";

export interface QrSegment {
  data: string;
  mode: "Byte" | "Alphanumeric";
}

export interface QrMatrix {
  size: number; // modules per side
  version: number;
  ecc: Ecc;
  dark: (r: number, c: number) => boolean;
}

/** Build a QR from one or more segments (so a URL prefix can be byte mode and the payload alphanumeric). */
export function makeQr(segments: QrSegment[], ecc: Ecc = "L"): QrMatrix {
  const qr = qrcode(0, ecc);
  for (const s of segments) qr.addData(s.data, s.mode);
  qr.make();
  const size = qr.getModuleCount();
  return { size, version: (size - 17) / 4, ecc, dark: (r, c) => qr.isDark(r, c) };
}

/** The pairing URL: `<origin>/lab/handshake/phone#o=<base43>` (path in byte mode, payload alphanumeric). */
export function offerQr(origin: string, payload: string, ecc: Ecc = "L", path = "/lab/handshake/phone"): QrMatrix {
  return makeQr(
    [
      { data: `${origin}${path}#o=`, mode: "Byte" },
      { data: payload, mode: "Alphanumeric" },
    ],
    ecc,
  );
}

/** The answer QR carries only the payload, with a short magic prefix. */
export const ANSWER_PREFIX = "HS1.";
export function answerQr(payload: string, ecc: Ecc = "L"): QrMatrix {
  return makeQr([{ data: ANSWER_PREFIX + payload, mode: "Alphanumeric" }], ecc);
}

export function parseAnswerText(text: string): string | null {
  const t = text.trim().toUpperCase();
  return t.startsWith(ANSWER_PREFIX) ? t.slice(ANSWER_PREFIX.length) : null;
}

/** Extract `o=` / `c=` style params from a URL fragment. */
export function parseFragment(hash: string): Record<string, string> {
  const out: Record<string, string> = {};
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  // payload alphabet contains + and : and /, so split on & only and never decode
  for (const part of h.split("&")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

export interface QrMetrics {
  version: number;
  modules: number;
  ecc: Ecc;
  /** fraction of dark modules */
  density: number;
  /** modules including the 4-module quiet zone, per side */
  withQuiet: number;
}

export function qrMetrics(q: QrMatrix): QrMetrics {
  let dark = 0;
  for (let r = 0; r < q.size; r++) for (let c = 0; c < q.size; c++) if (q.dark(r, c)) dark++;
  return {
    version: q.version,
    modules: q.size,
    ecc: q.ecc,
    density: dark / (q.size * q.size),
    withQuiet: q.size + 8,
  };
}

/** Draw into a canvas with an integer pixel size per module and a 4-module quiet zone. */
export function drawQr(canvas: HTMLCanvasElement, q: QrMatrix, cssWidth: number) {
  const total = q.size + 8;
  const px = Math.max(1, Math.floor(cssWidth / total));
  const dpr = typeof window === "undefined" ? 1 : Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const side = total * px * dpr;
  canvas.width = side;
  canvas.height = side;
  canvas.style.width = `${total * px}px`;
  canvas.style.height = `${total * px}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, side, side);
  ctx.fillStyle = "#000";
  const m = px * dpr;
  for (let r = 0; r < q.size; r++)
    for (let c = 0; c < q.size; c++) if (q.dark(r, c)) ctx.fillRect((c + 4) * m, (r + 4) * m, m, m);
}
