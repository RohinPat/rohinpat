"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ALL_APPS, GLYPHS, type App } from "./apps";

// Spotlight: a search sheet over the home screen. Filters the apps by name
// as you type; arrows move, Enter opens, Escape closes. Local only.

export default function Spotlight({
  open,
  onClose,
  onOpenApp,
}: {
  open: boolean;
  onClose: () => void;
  onOpenApp: (app: App) => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? ALL_APPS.filter((a) => a.name.toLowerCase().includes(s)) : ALL_APPS;
  }, [q]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
    const id = window.setTimeout(() => input.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => setSel(0), [q]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && results[sel]) {
      e.preventDefault();
      onOpenApp(results[sel]);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      className="fixed inset-0 z-[75] flex items-start justify-center px-4 pt-[14vh] bg-[rgba(13,16,14,0.35)] backdrop-blur-md animate-[rise_0.2s_ease-out]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={onKey}
    >
      <div className="w-full max-w-lg rounded-[22px] bg-[rgba(242,234,215,0.92)] text-[var(--ink)] shadow-2xl border border-white/40 overflow-hidden">
        <label className="flex items-center gap-3 px-5 py-4 border-b border-[rgba(13,16,14,0.1)]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="sr-only">Search the site</span>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            role="combobox"
            aria-expanded="true"
            aria-controls="spotlight-results"
            aria-activedescendant={results[sel] ? `spot-${results[sel].id}` : undefined}
            className="flex-1 bg-transparent text-lg outline-none placeholder:text-[var(--paper-muted)]"
          />
          <kbd className="font-mono text-[11px] text-[var(--paper-muted)]">esc</kbd>
        </label>
        <ul id="spotlight-results" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-4 text-[var(--paper-muted)]">No results</li>}
          {results.map((a, i) => (
            <li
              key={a.id}
              id={`spot-${a.id}`}
              role="option"
              aria-selected={i === sel}
              onMouseEnter={() => setSel(i)}
              onClick={() => onOpenApp(a)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer ${
                i === sel ? "bg-[var(--ink)] text-[var(--paper)]" : ""
              }`}
            >
              <span
                aria-hidden="true"
                className="grid place-items-center w-9 h-9 rounded-[22%] shrink-0"
                style={{ background: a.tile, color: a.ink }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  {GLYPHS[a.glyph]}
                </svg>
              </span>
              <span className="font-medium">{a.name}</span>
              <span className={`ml-auto text-sm ${i === sel ? "opacity-70" : "text-[var(--paper-muted)]"}`}>
                {a.external ? "Opens elsewhere" : "Page"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
