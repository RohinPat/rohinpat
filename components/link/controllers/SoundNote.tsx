"use client";

import { useEffect, useState } from "react";
import type { ControllerProps } from "./types";

// "Tap the laptop once for sound." The laptop's browser keeps a game silent
// until it has had a click or a key, and a game opened from this phone hasn't
// had one. The laptop says so with the gesture `audio` {blocked}; this asks
// for the current answer on mount (`audio-sync`) and shows a line while it is
// blocked. Nothing else on the phone depends on it.

export default function SoundNote({ send, subscribe }: Pick<ControllerProps, "send" | "subscribe">) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const off = subscribe((m) => {
      if (m.type === "gesture" && m.name === "audio") setBlocked(m.data?.blocked === true);
    });
    send({ type: "gesture", name: "audio-sync", data: {} });
    return off;
  }, [send, subscribe]);

  return (
    <div role="status" data-testid="phone-sound-note-region">
      {blocked && (
        <p data-testid="phone-sound-note" className="mt-2 rounded-[14px] bg-white/10 border border-white/15 px-3.5 py-2 text-[0.95rem] leading-snug text-[#c9c6b6]">
          Tap the laptop once for sound.
        </p>
      )}
    </div>
  );
}
