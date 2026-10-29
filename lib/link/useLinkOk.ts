"use client";

import { useEffect, useState } from "react";

// The phone link is for mouse-first wide screens: never on a phone or a tablet.
// False until mounted, so nothing for the link renders on the server.
const QUERY = "(min-width: 768px) and (hover: hover) and (pointer: fine)";

export function useLinkOk(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setOk(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return ok;
}
