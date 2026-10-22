"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { burst, getAudio } from "@/components/offhours/audio";
import { vote, type Vote } from "@/lib/colour";

// The lock screen's camera: point it at a shirt and it names the colours the
// way Closet Organizer does (lib/colour.ts is a port of the backend). The
// square in the middle is the backend's own fallback crop when there's no
// cutout: the centre 60% of the shorter side. Frames are read in this
// browser tab and go nowhere; the camera stops when this closes. No camera,
// or a "no": pick a photo or try a sample outfit instead.

type Mode = "starting" | "live" | "frozen" | "still";
type Result = { all: Vote[]; picked: Vote[] };

const RETICLE = 0.6;
const GRID = 64; // 4,096 pixels, about the backend's 4,000-pixel sample

const SAMPLES = [
  { label: "Striped knit", base: [18, 26, 66], stripe: [236, 228, 212] },
  { label: "Field jacket", base: [104, 98, 50], stripe: null },
  { label: "Dusty pink tee", base: [222, 168, 192], stripe: null },
] as const;

/** a shaded garment on a rumpled duvet, drawn rather than shipped as a photo */
function drawSample(i: number) {
  const s = SAMPLES[i % SAMPLES.length];
  const c = document.createElement("canvas");
  c.width = 600;
  c.height = 800;
  const g = c.getContext("2d")!;
  const duvet = g.createLinearGradient(0, 0, 600, 800);
  duvet.addColorStop(0, "#f4f1ea");
  duvet.addColorStop(0.55, "#dedad1");
  duvet.addColorStop(1, "#f1ede5");
  g.fillStyle = duvet;
  g.fillRect(0, 0, 600, 800);
  // a tee/jumper silhouette, close up: the square should be all garment,
  // since there's no cutout here to drop the duvet
  g.translate(300, 420);
  g.scale(1.75, 1.3);
  g.translate(-300, -420);
  g.beginPath();
  g.moveTo(215, 150);
  g.quadraticCurveTo(300, 200, 385, 150);
  g.lineTo(520, 215);
  g.lineTo(480, 330);
  g.lineTo(420, 305);
  g.lineTo(430, 680);
  g.lineTo(170, 680);
  g.lineTo(180, 305);
  g.lineTo(120, 330);
  g.lineTo(80, 215);
  g.closePath();
  g.save();
  g.clip();
  const [r, gg, b] = s.base;
  const light = g.createLinearGradient(120, 150, 480, 680);
  light.addColorStop(0, `rgb(${Math.min(255, r * 1.25)},${Math.min(255, gg * 1.25)},${Math.min(255, b * 1.25)})`);
  light.addColorStop(1, `rgb(${r * 0.7},${gg * 0.7},${b * 0.7})`);
  g.fillStyle = light;
  g.fillRect(0, 0, 600, 800);
  if (s.stripe) {
    g.fillStyle = `rgb(${s.stripe.join(",")})`;
    for (let y = 330; y < 640; y += 70) g.fillRect(0, y, 600, 22);
  }
  // knit: speckle and a soft fold shadow
  for (let k = 0; k < 9000; k++) {
    g.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)";
    g.fillRect(Math.random() * 600, Math.random() * 800, 2, 2);
  }
  const fold = g.createLinearGradient(260, 0, 360, 0);
  fold.addColorStop(0, "rgba(0,0,0,0)");
  fold.addColorStop(0.5, "rgba(0,0,0,0.18)");
  fold.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = fold;
  g.fillRect(0, 0, 600, 800);
  g.restore();
  return { url: c.toDataURL("image/jpeg", 0.9), label: s.label };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const css = ([r, g, b]: [number, number, number]) => `rgb(${r},${g},${b})`;

export default function CameraApp({ onClose }: { onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const still = useRef<HTMLImageElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const scratch = useRef<HTMLCanvasElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const photoUrl = useRef<string | null>(null);
  const nextSample = useRef(0);
  const [mode, setMode] = useState<Mode>("starting");
  const [hasCam, setHasCam] = useState<boolean | null>(null);
  const [src, setSrc] = useState<{ url: string; label: string } | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [said, setSaid] = useState("");
  // in a framed device it lives inside the screen; on a phone the page is the
  // screen, so it goes over everything, the site nav included
  const [framed] = useState(() => window.matchMedia("(min-width: 768px)").matches);

  const sample = useCallback(() => {
    const s = drawSample(nextSample.current++);
    video.current?.pause();
    setSrc(s);
    setMode("still");
  }, []);

  // the camera: rear-facing on phones; any failure falls back to a sample
  useEffect(() => {
    let dead = false;
    closeBtn.current?.focus({ preventScroll: true });
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md?.getUserMedia) {
      setHasCam(false);
      sample();
    } else {
      md.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false })
        .then((s) => {
          if (dead) return s.getTracks().forEach((t) => t.stop());
          stream.current = s;
          setHasCam(true);
          const v = video.current!;
          v.srcObject = s;
          void v.play();
          setMode("live");
        })
        .catch(() => {
          if (dead) return;
          setHasCam(false);
          sample();
        });
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      dead = true;
      window.removeEventListener("keydown", onKey);
      stream.current?.getTracks().forEach((t) => t.stop());
      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
    };
  }, [onClose, sample]);

  useEffect(() => {
    const el = view.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // read the square: same crop the screen shows (object-cover), 64×64, vote
  const analyse = useCallback(() => {
    const el = mode === "still" ? still.current : video.current;
    const frame = view.current;
    if (!el || !frame) return;
    const sw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const sh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    const dw = frame.clientWidth;
    const dh = frame.clientHeight;
    if (!sw || !sh || !dw || !dh) return;
    const side = (RETICLE * Math.min(dw, dh)) / Math.max(dw / sw, dh / sh);
    const c = (scratch.current ??= document.createElement("canvas"));
    c.width = c.height = GRID;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(el, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, GRID, GRID);
    const out = vote(ctx.getImageData(0, 0, GRID, GRID).data);
    setRes(out);
    // announced when the names change, not four times a second
    setSaid(out.picked.map((v) => v.name).join(" and "));
  }, [mode]);

  useEffect(() => {
    if (mode !== "live") return;
    const id = window.setInterval(analyse, 250);
    return () => window.clearInterval(id);
  }, [mode, analyse]);

  const shutter = () => {
    const au = getAudio();
    if (au) {
      burst(au, { freq: 5200, q: 2, dur: 0.03, gain: 0.45 });
      burst(au, { freq: 2600, q: 2, dur: 0.05, gain: 0.35, at: 0.07 });
    }
    if (mode === "live") {
      analyse();
      video.current?.pause();
      setMode("frozen");
    } else if (hasCam) {
      setSrc(null);
      void video.current?.play();
      setMode("live");
    } else {
      sample();
    }
  };

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
    photoUrl.current = URL.createObjectURL(f);
    video.current?.pause();
    setSrc({ url: photoUrl.current, label: "Your photo" });
    setMode("still");
  };

  const ret = Math.round(RETICLE * Math.min(box.w, box.h));
  const top = res?.picked ?? [];
  const live = mode === "live";

  const app = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Colour namer"
      className={`${framed ? "absolute z-40" : "fixed z-[95]"} inset-0 flex flex-col bg-black text-[var(--paper)] select-none`}
      style={{ touchAction: "manipulation" }}
    >
      <div className={`shrink-0 flex items-center justify-between px-4 ${framed ? "pt-[58px]" : "pt-[max(env(safe-area-inset-top),14px)]"} pb-2`}>
        <button
          ref={closeBtn}
          type="button"
          onClick={onClose}
          aria-label="Close the camera"
          className="w-10 h-10 rounded-full grid place-items-center bg-white/10 hover:bg-white/20"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#f5c542]">Colour</p>
        <span className="w-10" aria-hidden="true" />
      </div>

      <div ref={view} className="relative flex-1 min-h-0 overflow-hidden bg-[#111]">
        <video ref={video} muted playsInline aria-hidden="true" className={`absolute inset-0 w-full h-full object-cover ${mode === "still" ? "invisible" : ""}`} />
        {src && mode === "still" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img ref={still} src={src.url} alt={src.label} onLoad={analyse} className="absolute inset-0 w-full h-full object-cover" />
        )}
        {mode === "starting" && <p className="absolute inset-0 grid place-items-center font-mono text-[11px] uppercase tracking-[0.2em] opacity-70">Asking for the camera…</p>}

        {/* the square that votes */}
        {ret > 0 && (
          <div aria-hidden="true" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: ret, height: ret }}>
            {["left-0 top-0 border-l-2 border-t-2 rounded-tl-lg", "right-0 top-0 border-r-2 border-t-2 rounded-tr-lg", "left-0 bottom-0 border-l-2 border-b-2 rounded-bl-lg", "right-0 bottom-0 border-r-2 border-b-2 rounded-br-lg"].map((c) => (
              <span key={c} className={`absolute w-7 h-7 border-[#f5c542] ${c}`} />
            ))}
          </div>
        )}

        {src && mode === "still" && (
          <p className="absolute left-3 top-3 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur font-mono text-[10px] uppercase tracking-[0.16em]">
            {hasCam === false ? `No camera · ${src.label}` : src.label}
          </p>
        )}

        {/* the answer */}
        {top.length > 0 && (
          <div className="absolute inset-x-3 bottom-3 rounded-2xl bg-black/60 backdrop-blur-md p-3">
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {top.map((v) => (
                <div key={v.name} className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-full border border-white/30" style={{ background: css(v.rgb) }} />
                  <span>
                    <span className="block text-[17px] font-semibold leading-none">{v.name}</span>
                    <span className="block font-mono text-[10px] tracking-[0.12em] opacity-75 mt-1">{pct(v.share)} OF THE VOTE</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex h-2 rounded-full overflow-hidden" aria-hidden="true">
              {res!.all.slice(0, 8).map((v) => (
                <span key={v.name} style={{ width: pct(v.share), background: css(v.rgb) }} title={`${v.name} ${pct(v.share)}`} />
              ))}
            </div>
          </div>
        )}
        <p aria-live="polite" className="sr-only">
          {said}
        </p>
      </div>

      <div className={`shrink-0 px-6 pt-4 ${framed ? "pb-6" : "pb-[max(env(safe-area-inset-bottom),14px)]"}`}>
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => file.current?.click()} className="w-14 font-mono text-[10px] uppercase tracking-[0.14em] opacity-85 hover:opacity-100">
            Photo
          </button>
          <button
            type="button"
            onClick={shutter}
            aria-label={live ? "Freeze the frame" : hasCam ? "Back to the live camera" : "Next sample"}
            className="w-[70px] h-[70px] rounded-full border-[4px] border-white grid place-items-center active:scale-95 transition-transform"
          >
            <span className={`block rounded-full transition-all ${live ? "w-[54px] h-[54px] bg-white" : "w-7 h-7 rounded-md bg-[#f5c542]"}`} />
          </button>
          <button type="button" onClick={sample} className="w-14 font-mono text-[10px] uppercase tracking-[0.14em] opacity-85 hover:opacity-100">
            Sample
          </button>
        </div>
        <p className="mt-3 text-center text-[12px] leading-snug opacity-70 text-pretty">
          Every pixel in the square votes, the way{" "}
          <Link href="/projects/closet-organizer" className="underline underline-offset-2">
            Closet Organizer
          </Link>{" "}
          names colours. Nothing leaves this device.
        </p>
        <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      </div>
    </div>
  );
  return framed ? app : createPortal(app, document.body);
}
