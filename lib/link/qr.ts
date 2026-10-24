import qrcode from "qrcode-generator";

// QR drawing for the pairing card. Returned as one SVG path (runs of dark
// modules per row) so it stays sharp at any scale, including inside the
// scaled phone frame, and a screen reader gets a single labelled image.

export const QUIET = 3; // modules of white margin; scanners need two or more

export type QrMatrix = { size: number; dark: (r: number, c: number) => boolean };

export function makeQr(text: string, ecc: "L" | "M" | "Q" | "H" = "M"): QrMatrix {
  const qr = qrcode(0, ecc);
  qr.addData(text, "Byte");
  qr.make();
  return { size: qr.getModuleCount(), dark: (r, c) => qr.isDark(r, c) };
}

/** Path data in module units, offset by the quiet zone. */
export function qrPath(m: QrMatrix, quiet = QUIET): string {
  const out: string[] = [];
  for (let r = 0; r < m.size; r++) {
    let c = 0;
    while (c < m.size) {
      if (!m.dark(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < m.size && m.dark(r, c)) c++;
      out.push(`M${start + quiet} ${r + quiet}h${c - start}v1h-${c - start}z`);
    }
  }
  return out.join("");
}

/** Side of the viewBox, quiet zone included. */
export const qrBox = (m: QrMatrix, quiet = QUIET): number => m.size + 2 * quiet;
