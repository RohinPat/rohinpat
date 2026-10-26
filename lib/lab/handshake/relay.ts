// Client helpers for the relay fallback (mode B). Same-origin only.

const API = "/lab/handshake/api";
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

export function makeCode(len = 4): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export interface Timed<T> {
  value: T;
  ms: number;
}

async function timed<T>(f: () => Promise<T>): Promise<Timed<T>> {
  const t0 = performance.now();
  const value = await f();
  return { value, ms: performance.now() - t0 };
}

export function postSlot(code: string, kind: "offer" | "answer", payload: string) {
  return timed(async () => {
    const r = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, kind, payload }),
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`relay POST ${kind} -> ${r.status}`);
    return true;
  });
}

export function getSlot(code: string, kind: "offer" | "answer") {
  return timed(async () => {
    const r = await fetch(`${API}?code=${encodeURIComponent(code)}&kind=${kind}`, { cache: "no-store" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`relay GET ${kind} -> ${r.status}`);
    return ((await r.json()) as { payload: string }).payload;
  });
}

export async function pollSlot(
  code: string,
  kind: "offer" | "answer",
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<{ payload: string; polls: number; lastRoundTripMs: number }> {
  const interval = opts.intervalMs ?? 250;
  const deadline = performance.now() + (opts.timeoutMs ?? 120000);
  let polls = 0;
  while (performance.now() < deadline) {
    polls++;
    const r = await getSlot(code, kind);
    if (r.value) return { payload: r.value, polls, lastRoundTripMs: r.ms };
    await new Promise((res) => setTimeout(res, interval));
  }
  throw new Error("relay poll timed out");
}
