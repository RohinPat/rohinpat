"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { LinkSession } from "@/lib/link/session";
import { onHostChange, peekHost } from "@/lib/link/useLink";

// The phone's way home. The home screen is the only page that listens to the
// phone as a remote, so once the laptop has gone somewhere else (Off hours, a
// project page) the phone's "Back to the home screen" sends open "home" and
// this, mounted on every page, brings the laptop back to /. It only looks at a
// link that already exists (peekHost), so with no phone it does nothing.
export default function LinkReturn() {
  const router = useRouter();
  const pathname = usePathname();
  const path = useRef(pathname);
  path.current = pathname;
  const [session, setSession] = useState<LinkSession | null>(null);

  useEffect(() => {
    const sync = () => setSession(peekHost());
    sync();
    return onHostChange(sync);
  }, []);

  useEffect(() => {
    if (!session) return;
    return session.onMessage((m) => {
      if (m.type === "open" && m.app === "home" && path.current !== "/") router.push("/");
    });
  }, [session, router]);

  return null;
}
