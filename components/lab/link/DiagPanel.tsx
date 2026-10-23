"use client";

import { useState } from "react";
import { fmtHz, fmtMs, fmtPair, fmtPct, type LinkSnapshot } from "@/lib/lab/link/diagnostics";
import css from "./link.module.css";

const row = (k: string, v: string) => [k, v] as const;

export function DiagList({ snap, label, testId }: { snap: Partial<LinkSnapshot> | null; label: string; testId: string }) {
  if (!snap) {
    return (
      <section aria-label={label}>
        <h3 style={{ fontSize: 13, margin: "8px 0" }}>{label}</h3>
        <p className={css.mono} style={{ opacity: 0.7 }}>
          waiting for numbers
        </p>
      </section>
    );
  }
  const rx = snap.orientRx;
  const dm = snap.devicemotion;
  const rows: (readonly [string, string])[] = [
    row("connection", `${snap.connectionState ?? "-"} / ice ${snap.iceState ?? "-"}`),
    row("time to connect", fmtMs(snap.answerToOpenMs ?? snap.shownToOpenMs, 0) + (snap.answerToOpenMs == null && snap.shownToOpenMs != null ? " (incl. aiming)" : "")),
  ];
  if (snap.scanMs != null) rows.push(row("QR scan took", fmtMs(snap.scanMs, 0)));
  rows.push(
    row("ICE pair (local <-> remote)", fmtPair(snap.pair ?? null)),
    row("RTT median / p95", snap.rtt ? `${fmtMs(snap.rtt.medianMs)} / ${fmtMs(snap.rtt.p95Ms)} (n=${snap.rtt.n})` : "-"),
  );
  if (rx && rx.expected > 0) {
    rows.push(
      row("orientation in", `${fmtHz(rx.recentHz)} now, ${fmtHz(rx.activeHz)} while moving`),
      row("orientation loss", `${fmtPct(rx.dropRate)} (${rx.received} of ${rx.expected}, ${rx.outOfOrder} out of order)`),
    );
  }
  const tx = snap.orientTx;
  if (tx && tx.total > 0) rows.push(row("orientation out", `${fmtHz(tx.recentHz)} now, ${fmtHz(tx.activeHz)} while moving`));
  if (dm) {
    rows.push(
      row("devicemotion interval", `median ${fmtMs(dm.medianMs)}, p95 ${fmtMs(dm.p95Ms)} (${fmtHz(dm.hz)})`),
      row("browser-reported interval", dm.reportedInterval == null ? "-" : String(dm.reportedInterval)),
    );
  }
  const ex = snap.extra ?? {};
  for (const [k, v] of Object.entries(ex)) rows.push(row(k, typeof v === "string" ? v : JSON.stringify(v)));
  rows.push(row("user agent", snap.userAgent ?? "-"));
  return (
    <section aria-label={label}>
      <h3 style={{ fontSize: 13, margin: "8px 0" }}>{label}</h3>
      <dl className={css.diag} data-testid={testId}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Builds the JSON on click, copies it, and always leaves it visible in case the clipboard is blocked. */
export function CopyResults({ build }: { build: () => unknown }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  async function copy() {
    const t = JSON.stringify(build(), null, 2);
    setText(t);
    try {
      await navigator.clipboard.writeText(t);
      setNote("Copied. Paste it back to Rohin.");
    } catch {
      setNote("Couldn't copy automatically. Select the text below and copy it by hand.");
    }
  }
  return (
    <div>
      <button type="button" className={css.btn} onClick={copy}>
        Copy results
      </button>
      <span role="status" aria-live="polite" className={css.mono} style={{ marginLeft: 10 }}>
        {note}
      </span>
      {text && (
        <textarea
          className={css.results}
          readOnly
          value={text}
          aria-label="Results JSON"
          data-testid="results-json"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
    </div>
  );
}
