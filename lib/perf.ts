// Pure helpers for the colophon's live numbers. The page measures itself
// with the browser's Performance API; these functions only summarise what
// the browser reports. Nothing is stored or sent anywhere.

export type ResourceLike = {
  name: string;
  initiatorType: string;
  transferSize?: number;
  encodedBodySize?: number;
};

export type Bucket = "document" | "script" | "style" | "font" | "image" | "other";
export const BUCKETS: Bucket[] = ["document", "script", "style", "font", "image", "other"];

export type Summary = {
  requests: number;
  /** bytes over the network; 0 for anything served from cache */
  transferred: number;
  /** compressed body bytes, cached or not — a stable measure of page weight */
  weight: number;
  byType: Record<Bucket, { count: number; transferred: number; weight: number }>;
  /** hostnames other than this site's */
  otherHosts: string[];
};

export function bucketOf(r: ResourceLike): Bucket {
  if (r.initiatorType === "navigation") return "document";
  const path = safePath(r.name);
  if (/\.(woff2?|ttf|otf)$/i.test(path)) return "font";
  if (/\.css$/i.test(path)) return "style";
  if (/\.m?js$/i.test(path) || r.initiatorType === "script") return "script";
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico)$/i.test(path) || r.initiatorType === "img") return "image";
  return "other";
}

function safePath(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function summarize(entries: ResourceLike[], origin: string): Summary {
  const byType = Object.fromEntries(
    BUCKETS.map((b) => [b, { count: 0, transferred: 0, weight: 0 }]),
  ) as Summary["byType"];
  const hosts = new Set<string>();
  const home = hostOf(origin);
  let transferred = 0;
  let weight = 0;

  for (const e of entries) {
    const t = Math.max(0, e.transferSize ?? 0);
    const w = Math.max(0, e.encodedBodySize ?? 0);
    const b = byType[bucketOf(e)];
    b.count += 1;
    b.transferred += t;
    b.weight += w;
    transferred += t;
    weight += w;
    const h = hostOf(e.name);
    if (h && h !== home) hosts.add(h);
  }
  return { requests: entries.length, transferred, weight, byType, otherHosts: Array.from(hosts).sort() };
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1000) return `${Math.round(n)} B`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} kB`;
  return `${(n / 1_000_000).toFixed(2)} MB`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** frames counted over a window → frames per second, rounded */
export function fps(frames: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  return Math.round((frames * 1000) / elapsedMs);
}
