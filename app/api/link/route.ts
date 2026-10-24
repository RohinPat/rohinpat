// The phone link's relay: a WebSocket on Vercel Functions (Fluid compute,
// public beta). Hosts ask for a room and get a short code; phones join it; the
// relay forwards frames between the two. `next dev` cannot upgrade WebSockets,
// so locally use `npm run link:relay` and NEXT_PUBLIC_LINK_RELAY.

import { upgradeWebSocket } from "@vercel/functions";
import { getHub } from "@/lib/link/relay/server";
import { attachSocket } from "@/lib/link/relay/ws-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Hobby's cap. The connection closes then; clients reconnect and resume their seat. */
export const maxDuration = 300;

/** A few KB is the frame cap; leave room for the envelope. ws closes the socket on anything bigger. */
const MAX_PAYLOAD = 8 * 1024;

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // not a browser
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const hub = await getHub();
  try {
    return await upgradeWebSocket((ws) => attachSocket(hub, ws), { maxPayload: MAX_PAYLOAD });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("not available in the current runtime")) {
      return new Response("This endpoint needs a WebSocket upgrade, which this server cannot do.", {
        status: 426,
        headers: { Upgrade: "websocket", "Cache-Control": "no-store" },
      });
    }
    throw e;
  }
}
