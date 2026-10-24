"use client";

import { useEffect, useRef, useState } from "react";
import { hostLink, joinLink, type LinkOptions } from "@/lib/link/client";
import { createRtcPeer, type DirectPeer } from "@/lib/link/peer";
import type { LinkMsg, LinkPath, LinkSession, LinkState, Orient } from "@/lib/link/session";

// A bare page that runs one end of the phone link, for the Playwright specs
// (e2e/link-relay.spec.ts) and for poking at it by hand.
//
//   /lab/linktest?role=host&relay=ws://localhost:3311
//   /lab/linktest?role=phone&code=ABCDE&relay=ws://localhost:3311
//
// Options: relay (ws URL), direct=0 (never try WebRTC), retry=0 (no direct retries), timeout=<ms>.
// Everything the specs need is on window.__t.

type Hook = {
  session: LinkSession | null;
  states: [LinkState, LinkPath | null][];
  msgs: LinkMsg[];
  orients: Orient[];
  peers: DirectPeer[];
};

export default function LinkTest() {
  const [state, setState] = useState<LinkState>("connecting");
  const [path, setPath] = useState<LinkPath | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [msgCount, setMsgCount] = useState(0);
  const [orientCount, setOrientCount] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const q = new URLSearchParams(window.location.search);
    const hook: Hook = { session: null, states: [], msgs: [], orients: [], peers: [] };
    (window as any).__t = hook;
    const opts: LinkOptions = {
      relayUrl: q.get("relay") ?? undefined,
      directRetryMs: q.get("retry") === "0" ? 0 : undefined,
      directTimeoutMs: q.get("timeout") ? Number(q.get("timeout")) : undefined,
      createPeer:
        q.get("direct") === "0"
          ? () => null
          : () => {
              const p = createRtcPeer();
              if (p) hook.peers.push(p);
              return p;
            },
      motion: () => "not-needed",
    };
    const role = q.get("role") === "host" ? "host" : "phone";
    const s = role === "host" ? hostLink(opts) : joinLink(q.get("code") ?? "", opts);
    hook.session = s;
    setState(s.state);
    s.onState((st, p) => {
      hook.states.push([st, p]);
      setState(st);
      setPath(p);
      setCode(s.code);
    });
    s.onMessage((m) => {
      hook.msgs.push(m);
      setMsgCount((n) => n + 1);
    });
    s.onOrient((o) => {
      hook.orients.push(o);
      setOrientCount((n) => n + 1);
    });
    setCode(s.code);
    // leaving the page says bye, so the other side hears about it at once
    window.addEventListener("pagehide", () => s.close());
  }, []);

  return (
    <main style={{ padding: 16, fontFamily: "monospace" }}>
      <h1>Link test</h1>
      <p role="status" aria-live="polite" data-testid="status" data-state={state} data-path={path ?? ""} data-code={code ?? ""}>
        state {state}, path {path ?? "none"}, code {code ?? "none"}
      </p>
      <p data-testid="counts" data-msgs={msgCount} data-orients={orientCount}>
        messages {msgCount}, orientation frames {orientCount}
      </p>
    </main>
  );
}
