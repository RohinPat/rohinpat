"use client";

// The browser's own print dialog; "Save as PDF" is one of its destinations.
// The page's print styles (app/globals.css) turn the page into a clean
// one- or two-page resume.
export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 px-5 py-3 bg-[var(--ink)] text-[var(--paper)] font-medium hover:bg-[var(--signal)] transition-colors"
    >
      Print / Save as PDF
    </button>
  );
}
