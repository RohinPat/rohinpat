"use client";

// The frame every controller sits in: a big Back button, the game's name and
// room for the controls. Sized for a thumb: 64px targets, 16px+ type.

export const bigButton =
  "w-full min-h-[64px] rounded-[20px] bg-[var(--mint)] text-[var(--ink)] text-[1.25rem] font-bold px-6 py-4 active:scale-[0.98] transition-transform disabled:opacity-40";
export const ghostButton =
  "min-h-[56px] w-full rounded-[20px] bg-white/10 border border-white/15 text-[var(--paper)] text-[1.1rem] font-semibold px-5 py-3 active:scale-[0.98] transition-transform";

export function Shell({
  label,
  index,
  onBack,
  children,
}: {
  label: string;
  index?: number;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="phone-piece">
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          data-testid="phone-back"
          className="min-h-[56px] shrink-0 rounded-full bg-white/10 border border-white/15 pl-4 pr-5 text-[1.05rem] font-semibold inline-flex items-center gap-2 active:scale-[0.97] transition-transform"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Back
        </button>
        <p className="font-mono text-[13px] uppercase tracking-[0.18em] text-[var(--mint)] truncate">
          {index !== undefined && <span className="text-[#a3a69c]">{String(index).padStart(2, "0")} · </span>}
          {label}
        </p>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );
}
