"use client";

import { useRef } from "react";
import type { LinkMsg } from "@/lib/link/session";
import { buzz } from "@/lib/haptics";
import { Shell, ghostButton } from "./Shell";

// The phone side of the air pointer lab (/lab/pointer). The phone keeps
// streaming its orientation here (LinkPhone makes an exception for this
// screen); this pad adds the buttons: a tap clicks where the dot is, a drag
// scrolls the laptop's page, Center says "I'm pointing at the middle now".

const TAP_MS = 280; // a touch shorter than this that barely moved is a click
const TAP_PX = 10;
const SCROLL_EVERY_MS = 33;

export default function PointerPad({ send, onBack }: { send: (m: LinkMsg) => void; onBack: () => void }) {
  const touch = useRef<{ x: number; y: number; t: number; lastY: number; lastSend: number; acc: number; moved: boolean } | null>(null);

  return (
    <Shell label="Air pointer" onBack={onBack}>
      <p className="mt-4 text-[1.05rem] leading-snug text-[#c9c6b6]">
        Point the top of your phone at the laptop, like a TV remote. Aim at the middle of the screen and press Center.
      </p>
      <div
        data-testid="pointer-pad"
        className="mt-4 flex-1 min-h-[220px] rounded-[24px] bg-white/[0.06] border border-white/15 grid place-items-center text-center px-6 touch-none select-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          touch.current = { x: e.clientX, y: e.clientY, t: performance.now(), lastY: e.clientY, lastSend: 0, acc: 0, moved: false };
        }}
        onPointerMove={(e) => {
          const s = touch.current;
          if (!s) return;
          if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > TAP_PX) s.moved = true;
          s.acc += s.lastY - e.clientY;
          s.lastY = e.clientY;
          const now = performance.now();
          if (s.moved && now - s.lastSend > SCROLL_EVERY_MS && s.acc !== 0) {
            // finger up = page up, like scrolling on the phone itself
            send({ type: "gesture", name: "pointer-scroll", data: { dy: Math.round(s.acc * 2.5) } });
            s.acc = 0;
            s.lastSend = now;
          }
        }}
        onPointerUp={() => {
          const s = touch.current;
          touch.current = null;
          if (!s) return;
          if (!s.moved && performance.now() - s.t < TAP_MS) {
            send({ type: "gesture", name: "pointer-click", data: {} });
            buzz(12);
          } else if (s.acc !== 0) send({ type: "gesture", name: "pointer-scroll", data: { dy: Math.round(s.acc * 2.5) } });
        }}
        onPointerCancel={() => (touch.current = null)}
      >
        <span className="text-[1.15rem] font-semibold text-[#c9c6b6]">
          Tap to click
          <br />
          Drag to scroll
        </span>
      </div>
      <button
        type="button"
        data-testid="pointer-center"
        onClick={() => {
          send({ type: "gesture", name: "pointer-center", data: {} });
          buzz(20);
        }}
        className={`${ghostButton} mt-3 mb-1`}
      >
        Center
      </button>
    </Shell>
  );
}
