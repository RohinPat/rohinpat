"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BUCKETS, formatBytes, formatMs, fps as toFps, summarize, type Summary } from "@/lib/perf";

// The colophon's numbers, measured in your browser with the Performance API.
// Read-only: nothing here is stored or sent anywhere.

type Snapshot = {
  summary: Summary;
  ttfb: number | null;
  domReady: number | null;
  cookies: number;
  storageKeys: number | null;
};

const LABELS: Record<(typeof BUCKETS)[number], string> = {
  document: "HTML",
  script: "JavaScript",
  style: "CSS",
  font: "Fonts",
  image: "Images",
  other: "Other",
};

function measure(): Snapshot {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const entries = [...(nav ? [nav] : []), ...resources];
  let storageKeys: number | null = null;
  try {
    storageKeys = window.localStorage.length + window.sessionStorage.length;
  } catch {
    storageKeys = null; // storage blocked entirely — which also means empty
  }
  return {
    summary: summarize(entries, location.origin),
    ttfb: nav ? nav.responseStart : null,
    domReady: nav ? nav.domContentLoadedEventEnd : null,
    cookies: document.cookie ? document.cookie.split(";").length : 0,
    storageKeys,
  };
}

function useLcp() {
  const [lcp, setLcp] = useState<number | null | "unsupported">(null);
  useEffect(() => {
    if (!PerformanceObserver.supportedEntryTypes?.includes("largest-contentful-paint")) {
      setLcp("unsupported");
      return;
    }
    const po = new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1);
      if (last) setLcp(last.startTime);
    });
    po.observe({ type: "largest-contentful-paint", buffered: true });
    return () => po.disconnect();
  }, []);
  return lcp;
}

// Frames per second, counted with requestAnimationFrame over one-second
// windows — only while the readout is on screen and the tab is visible.
function useFps(ref: React.RefObject<HTMLElement>) {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let frames = 0;
    let start = 0;
    let visible = false;
    const frame = (t: number) => {
      if (!start) start = t;
      frames += 1;
      if (t - start >= 1000) {
        setValue(toFps(frames, t - start));
        frames = 0;
        start = t;
      }
      raf = requestAnimationFrame(frame);
    };
    const run = () => {
      cancelAnimationFrame(raf);
      frames = 0;
      start = 0;
      if (visible && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      run();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", run);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", run);
    };
  }, [ref]);
  return value;
}

export default function LiveMetrics() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const lcp = useLcp();
  const fpsRef = useRef<HTMLDivElement>(null);
  const fps = useFps(fpsRef);

  const refresh = useCallback(() => setSnap(measure()), []);
  useEffect(() => {
    refresh();
    // late resources (fonts, lazy chunks) land after hydration
    const id = setTimeout(refresh, 1500);
    return () => clearTimeout(id);
  }, [refresh]);

  const s = snap?.summary;
  const lcpText = lcp === "unsupported" ? "not reported by this browser" : formatMs(lcp);

  return (
    <div className="rounded-md bg-[var(--ink)] text-[var(--paper)] p-5 md:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-semibold text-lg !m-0">This page, in your browser</h3>
        <button
          type="button"
          onClick={refresh}
          className="font-mono text-xs uppercase tracking-wider px-3 py-1.5 border border-white/25 hover:border-[var(--mint)] hover:text-[var(--mint)] transition-colors"
        >
          Measure again
        </button>
      </div>

      <dl className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-px bg-white/10 border border-white/10">
        <Stat label="Requests" value={s ? String(s.requests) : "—"} />
        <Stat label="Page weight" value={s ? formatBytes(s.weight) : "—"} hint="compressed" />
        <Stat label="Time to first byte" value={formatMs(snap?.ttfb)} />
        <Stat label="Largest paint" value={lcpText} />
        <Stat label="Other domains" value={s ? String(s.otherHosts.length) : "—"} hint={s?.otherHosts.join(", ") || undefined} />
        <Stat label="Cookies" value={snap ? String(snap.cookies) : "—"} />
        <Stat label="Storage keys" value={snap ? (snap.storageKeys === null ? "blocked" : String(snap.storageKeys)) : "—"} />
        <Stat label="Frame rate" value={fps === null ? "—" : `${fps} fps`} hint="live" boxRef={fpsRef} />
      </dl>

      <table className="mt-6 w-full text-sm">
        <caption className="sr-only">Bytes by type</caption>
        <thead>
          <tr className="text-left font-mono text-[11px] uppercase tracking-wider text-[#a3a69c]">
            <th scope="col" className="py-2 font-normal">Type</th>
            <th scope="col" className="py-2 font-normal text-right">Files</th>
            <th scope="col" className="py-2 font-normal text-right">Weight</th>
            <th scope="col" className="py-2 font-normal text-right">Over the network</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {BUCKETS.filter((b) => !s || s.byType[b].count > 0).map((b) => (
            <tr key={b} className="border-t border-white/10">
              <th scope="row" className="py-2 font-normal text-left">{LABELS[b]}</th>
              <td className="py-2 text-right">{s ? s.byType[b].count : "—"}</td>
              <td className="py-2 text-right">{s ? formatBytes(s.byType[b].weight) : "—"}</td>
              <td className="py-2 text-right text-[#a3a69c]">{s ? formatBytes(s.byType[b].transferred) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-[0.8125rem] leading-relaxed text-[#a3a69c] !mb-0">
        Counted since this tab first loaded the site, so pages you&apos;ve visited before
        this one share their files. &ldquo;Over the network&rdquo; is zero for anything your
        browser already had cached. Nothing on this panel leaves your machine.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  boxRef,
}: {
  label: string;
  value: string;
  hint?: string;
  boxRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div ref={boxRef} className="bg-[var(--ink)] p-3.5 md:p-4 min-w-0">
      <dt className="font-mono text-[11px] uppercase tracking-wider text-[#a3a69c]">{label}</dt>
      <dd className="mt-1.5 text-xl md:text-2xl font-semibold tabular-nums leading-tight break-words">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-[#a3a69c] break-words">{hint}</dd>}
    </div>
  );
}
