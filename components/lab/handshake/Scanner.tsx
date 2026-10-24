"use client";

import { useEffect, useRef, useState } from "react";
import { parseAnswerText } from "@/lib/lab/handshake/qr";

export interface ScanStats {
  frames: number;
  decodeMsAvg: number;
  videoWidth: number;
  videoHeight: number;
  firstHitMs: number | null;
}

/** Opens the webcam and runs jsQR on frames until it reads an `HS1.` answer code. */
export default function Scanner({
  onAnswer,
  onStats,
}: {
  onAnswer: (payload: string) => void;
  onStats?: (s: ScanStats) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState("Starting camera…");
  const cb = useRef({ onAnswer, onStats });
  cb.current = { onAnswer, onStats };

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const t0 = performance.now();
    const stats: ScanStats = { frames: 0, decodeMsAvg: 0, videoWidth: 0, videoHeight: 0, firstHitMs: null };

    async function start() {
      // jsQR is ~45 kB gzipped; only load it once the visitor asks to scan
      const jsQR = (await import("jsqr")).default;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch (e) {
        setError(e instanceof Error ? `${e.name}: ${e.message}` : "Camera unavailable");
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      setState("Looking for your phone's code…");
      const c = canvasRef.current!;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.imageSmoothingQuality = "high";
      const loop = () => {
        if (stopped) return;
        if (v.videoWidth > 0) {
          stats.videoWidth = v.videoWidth;
          stats.videoHeight = v.videoHeight;
          const t = performance.now();
          // jsQR's binarizer falls apart on sensor noise in flat areas (measured: sigma >= ~5 grey
          // levels). Re-decoding a 2x / 4x box-downscaled copy averages the noise out, so try the
          // full frame first and then the smaller ones.
          let hit: ReturnType<typeof jsQR> = null;
          for (const div of [1, 2, 4]) {
            const w = Math.floor(v.videoWidth / div);
            const h = Math.floor(v.videoHeight / div);
            if (w < 160) break;
            c.width = w;
            c.height = h;
            ctx.drawImage(v, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            hit = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (hit) break;
          }
          const dt = performance.now() - t;
          stats.frames++;
          stats.decodeMsAvg += (dt - stats.decodeMsAvg) / stats.frames;
          if (hit) {
            const payload = parseAnswerText(hit.data);
            if (payload) {
              stats.firstHitMs = performance.now() - t0;
              cb.current.onStats?.({ ...stats });
              setState("Got it.");
              cb.current.onAnswer(payload);
              return;
            }
          }
          if (stats.frames % 10 === 0) cb.current.onStats?.({ ...stats });
        }
        timer = setTimeout(loop, 60);
      };
      loop();
    }
    start();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div>
      <video ref={videoRef} muted playsInline aria-label="Camera preview" style={{ width: "100%", maxWidth: 480, background: "#000" }} />
      <canvas ref={canvasRef} hidden />
      {error ? (
        <p role="alert">Camera unavailable ({error}). Use the relay mode or paste the code below.</p>
      ) : (
        <p aria-live="polite">{state}</p>
      )}
    </div>
  );
}
