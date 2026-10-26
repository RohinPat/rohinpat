// Wraps a `ws` socket (the library Vercel's upgradeWebSocket and the dev relay
// both use) as the hub's RelaySocket, and feeds its events to the hub.

import type { WebSocket, RawData } from "ws";
import type { RelayHub } from "./hub";

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export function attachSocket(hub: RelayHub, ws: WebSocket): void {
  const conn = hub.connect({
    send: (d) => {
      if (ws.readyState === ws.OPEN) ws.send(d);
    },
    close: (code, reason) => {
      try {
        ws.close(code, reason);
      } catch {
        ws.terminate();
      }
    },
    get bufferedAmount() {
      return ws.bufferedAmount;
    },
  });
  ws.on("message", (data, isBinary) => {
    conn.message(isBinary ? toBytes(data) : Array.isArray(data) ? Buffer.concat(data).toString("utf8") : data.toString("utf8"));
  });
  ws.on("close", () => conn.close());
  ws.on("error", () => conn.close());
}
