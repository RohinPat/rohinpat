import { Session, type Req, type Res } from "./session";

// How the page reaches the session: a Web Worker where there is one (built in
// to the browser: no download and no request beyond this site), or, where there
// is not (a test, an old browser), the same Session worked a few milliseconds a
// frame on the page's own thread. The page sends the same messages either way.

export type Link = {
  readonly kind: "worker" | "local";
  post(req: Req): void;
  onmessage: ((res: Res) => void) | null;
  /** called once a frame: the local link works for `budgetMs` (the worker does its own) */
  pump(budgetMs: number): void;
  close(): void;
};

function workerLink(w: Worker): Link {
  const link: Link = {
    kind: "worker",
    post: (req) => w.postMessage(req),
    onmessage: null,
    pump: () => {},
    close: () => w.terminate(),
  };
  w.onmessage = (e: MessageEvent<Res>) => link.onmessage?.(e.data);
  return link;
}

export function localLink(): Link {
  const session = new Session();
  const link: Link = {
    kind: "local",
    post: (req) => session.request(req),
    onmessage: null,
    pump: (budgetMs) => {
      session.work(budgetMs);
    },
    close: () => session.request({ type: "stop" }),
  };
  session.post = (res) => link.onmessage?.(res);
  return link;
}

/** open a link: a worker if the browser has one and it starts, else the local one */
export function openLink(forceLocal = false): Link {
  if (!forceLocal && typeof Worker !== "undefined") {
    try {
      return workerLink(new Worker(new URL("./learn.worker.ts", import.meta.url)));
    } catch {
      /* no worker after all: fall through */
    }
  }
  return localLink();
}
