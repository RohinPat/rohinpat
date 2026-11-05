import { Session, type Req } from "./session";

// The worker: a Session, driven by the page's messages. It works in slices of
// 40 ms and gives the thread back between them, so a `stop` or a new `start`
// is heard within a slice.

const session = new Session();
const scope = self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void; onmessage: ((e: MessageEvent<Req>) => void) | null };
session.post = (res, transfer) => scope.postMessage(res, transfer ?? []);

let timer: ReturnType<typeof setTimeout> | null = null;
function pump() {
  timer = null;
  if (session.work(40)) timer = setTimeout(pump, 0);
}

scope.onmessage = (e) => {
  session.request(e.data);
  if (timer === null && session.busy) timer = setTimeout(pump, 0);
};
