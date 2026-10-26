// Standalone dev relay for the phone link. `next dev` cannot upgrade
// WebSockets, so this serves the same relay logic (lib/link/relay) on its own
// port:
//
//   npm run link:relay                     # ws://localhost:3311
//   PORT=3312 node scripts/link-relay-dev.mjs
//   NEXT_PUBLIC_LINK_RELAY=ws://localhost:3311 npm run dev
//
// It imports the TypeScript sources directly (Node 22.18+/24 strip types), with
// a tiny resolve hook so the extensionless imports Next and tsc use still work.
// REDIS_URL / KV_URL, if set, switch it to the Redis bus (to try cross-instance
// delivery: run two of these on different ports against one Redis).
//
// Dev-only admin endpoints, for tests:
//   GET  /__health
//   GET  /__stats
//   POST /__drop?code=ABCDE&side=host|phone     kill that socket as if the network dropped
//   POST /__limits?codeTtlMs=1500&graceMs=800   change limits for rooms from now on

import { registerHooks } from "node:module";
import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]s$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        /* fall through to the plain specifier */
      }
    }
    return nextResolve(specifier, context);
  },
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = (p) => import(pathToFileURL(resolve(root, p)).href);
const { WebSocketServer } = await import("ws");
const { RelayHub } = await load("lib/link/relay/hub.ts");
const { createBus } = await load("lib/link/relay/bus.ts");
const { attachSocket } = await load("lib/link/relay/ws-adapter.ts");

const port = Number(process.env.PORT ?? 3311);
const bus = await createBus({ ...process.env, NODE_ENV: "development" });
const hub = new RelayHub({ bus, log: (m) => console.log(m) });

// Testing on a real phone needs HTTPS (iOS only gives motion to secure pages),
// and a secure page can only reach a wss:// relay. Point these at a local
// certificate to serve wss:// instead:
//   LINK_RELAY_TLS_KEY=key.pem LINK_RELAY_TLS_CERT=cert.pem npm run link:relay
const tls = process.env.LINK_RELAY_TLS_KEY && process.env.LINK_RELAY_TLS_CERT
  ? { key: readFileSync(process.env.LINK_RELAY_TLS_KEY), cert: readFileSync(process.env.LINK_RELAY_TLS_CERT) }
  : null;
const listen = (handler) => (tls ? createTlsServer(tls, handler) : createServer(handler));
const server = listen((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const send = (code, body) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/__health") return send(200, { ok: true, bus: bus.kind });
  if (url.pathname === "/__stats") return send(200, hub.stats());
  if (url.pathname === "/__drop" && req.method === "POST") {
    const side = url.searchParams.get("side");
    const code = url.searchParams.get("code") ?? "";
    if (side !== "host" && side !== "phone") return send(400, { error: "side" });
    return send(200, { dropped: hub.debugDrop(code, side) });
  }
  if (url.pathname === "/__limits" && req.method === "POST") {
    for (const [k, v] of url.searchParams) if (k in hub.limits && Number.isFinite(Number(v))) hub.limits[k] = Number(v);
    return send(200, hub.limits);
  }
  send(404, { error: "not found; the WebSocket is on any path" });
});

const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 });
wss.on("connection", (ws) => attachSocket(hub, ws));

server.listen(port, () => console.log(`link relay (dev) on ${tls ? "wss" : "ws"}://localhost:${port}  bus=${bus.kind}`));

const stop = () => {
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
