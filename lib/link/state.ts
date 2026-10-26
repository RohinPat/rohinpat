import type { LinkPath, LinkState } from "./session";

/** Whether the two devices can talk right now. The real session sits in
 *  "connecting" for up to 8 s after pairing while it tries the direct path,
 *  and messages already flow over the relay then; a path is what says so. */
export function isPaired(state: LinkState | "idle", path: LinkPath | null): boolean {
  return state === "live" || state === "reconnecting" || (state === "connecting" && path !== null);
}
