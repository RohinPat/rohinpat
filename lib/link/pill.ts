import type { LinkPath, LinkState } from "./session";

/** The little status pill beside the device: "Linked · direct · 12 ms". */
export function pillLabel(state: LinkState | "idle", path: LinkPath | null, rttMs: number | null): string {
  switch (state) {
    case "live": {
      const parts = ["Linked", path ?? "relay"];
      if (rttMs !== null && Number.isFinite(rttMs)) parts.push(`${Math.max(1, Math.round(rttMs))} ms`);
      return parts.join(" · ");
    }
    case "reconnecting":
      return "Reconnecting…";
    case "connecting":
      return "Linking…";
    default:
      return "Not linked";
  }
}

export function pathExplainer(path: LinkPath | null): string {
  if (path === "direct") return "Direct: straight between your phone and this laptop";
  if (path === "relay") return "Relay: through this site's server";
  return "Not connected";
}
