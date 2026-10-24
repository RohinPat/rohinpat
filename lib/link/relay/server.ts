// One RelayHub per server instance, built on first use. Used by the Vercel
// route; the dev relay builds its own so it can choose the bus and limits.

import { createBus } from "./bus";
import { RelayHub } from "./hub";

const g = globalThis as unknown as { __linkHub?: Promise<RelayHub> };

/** Survives dev hot reloads; one hub (and one Redis connection) per instance. */
export function getHub(): Promise<RelayHub> {
  if (!g.__linkHub) {
    g.__linkHub = createBus().then((bus) => new RelayHub({ bus, log: (m) => console.warn(m) }));
    g.__linkHub.catch(() => {
      g.__linkHub = undefined; // try again on the next request
    });
  }
  return g.__linkHub;
}
