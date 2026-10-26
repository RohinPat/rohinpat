// POC relay for pairing mode B.
//
// In-memory Map on a single Node process. This is NOT production-safe on
// Vercel: serverless instances do not share memory, so the POST and the GET
// can land on different instances. Production needs a short-lived store
// (Vercel KV / Upstash Redis with a 60-120 s TTL, keyed by the pairing code).
// The payload is the minified SDP (~140 chars): a DTLS certificate fingerprint and
// short-lived ICE credentials plus candidate addresses; no account data.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface Slot {
  offer?: string;
  answer?: string;
  expires: number;
}

const TTL_MS = 120_000;
const MAX_SLOTS = 500;
const g = globalThis as unknown as { __hsRelay?: Map<string, Slot> };
const store = (g.__hsRelay ??= new Map<string, Slot>());

function sweep() {
  const now = Date.now();
  store.forEach((v, k) => {
    if (v.expires < now) store.delete(k);
  });
}

const CODE_RE = /^[A-Z0-9]{4,8}$/;
const PAYLOAD_RE = /^[0-9A-Z$*+\-./:]{20,1200}$/;
const NO_STORE = { "cache-control": "no-store" };

export async function POST(req: Request) {
  sweep();
  let body: { code?: string; kind?: string; payload?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400, headers: NO_STORE });
  }
  const { code, kind, payload } = body;
  if (!code || !CODE_RE.test(code) || (kind !== "offer" && kind !== "answer") || !payload || !PAYLOAD_RE.test(payload)) {
    return NextResponse.json({ error: "bad request" }, { status: 400, headers: NO_STORE });
  }
  const slot = store.get(code);
  if (kind === "offer") {
    if (!slot && store.size >= MAX_SLOTS) return NextResponse.json({ error: "full" }, { status: 503, headers: NO_STORE });
    store.set(code, { offer: payload, expires: Date.now() + TTL_MS });
  } else {
    if (!slot?.offer) return NextResponse.json({ error: "no such code" }, { status: 404, headers: NO_STORE });
    slot.answer = payload;
    slot.expires = Date.now() + TTL_MS;
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}

export async function GET(req: Request) {
  sweep();
  const u = new URL(req.url);
  const code = u.searchParams.get("code") ?? "";
  const kind = u.searchParams.get("kind");
  if (!CODE_RE.test(code) || (kind !== "offer" && kind !== "answer")) {
    return NextResponse.json({ error: "bad request" }, { status: 400, headers: NO_STORE });
  }
  const payload = store.get(code)?.[kind];
  if (!payload) return NextResponse.json({ error: "not found" }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ payload }, { headers: NO_STORE });
}
