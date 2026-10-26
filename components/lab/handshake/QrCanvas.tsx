"use client";

import { useEffect, useRef } from "react";
import { drawQr, type QrMatrix } from "@/lib/lab/handshake/qr";

export default function QrCanvas({
  qr,
  width,
  label,
}: {
  qr: QrMatrix | null;
  width: number;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && qr) drawQr(ref.current, qr, width);
  }, [qr, width]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label}
      data-testid="qr"
      style={{ imageRendering: "pixelated", background: "#fff", maxWidth: "100%" }}
    />
  );
}
