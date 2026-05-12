// Returns the site owner's top tracks on Spotify.
//   ?range=short_term  → last ~4 weeks
//   ?range=medium_term → last ~6 months (default)
//   ?range=long_term   → multi-year, all-time-ish
//
// Requires the same env vars as /api/spotify/now-playing (see .env.local.example),
// PLUS the `user-top-read` scope (now in /api/spotify/setup).

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Range = "short_term" | "medium_term" | "long_term";

type Track = {
  title: string;
  artist: string;
  album: string;
  albumArt: string | null;
  url: string | null;
};

type Out =
  | { configured: false }
  | { configured: true; range: Range; tracks: Track[] };

export async function GET(req: NextRequest) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return NextResponse.json<Out>(
      { configured: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const { searchParams } = new URL(req.url);
  const rangeParam = (searchParams.get("range") ?? "medium_term") as Range;
  const range: Range =
    rangeParam === "short_term" || rangeParam === "medium_term" || rangeParam === "long_term"
      ? rangeParam
      : "medium_term";
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "5"), 1), 20);

  // 1) Refresh access token
  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });

  if (!tokenRes.ok) {
    return NextResponse.json(
      { error: "spotify_refresh_failed", status: tokenRes.status },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  // 2) Fetch top tracks
  const topRes = await fetch(
    `https://api.spotify.com/v1/me/top/tracks?time_range=${range}&limit=${limit}`,
    {
      headers: { Authorization: `Bearer ${access_token}` },
      cache: "no-store",
    },
  );

  if (!topRes.ok) {
    const status = topRes.status;
    let body: any;
    try { body = await topRes.json(); } catch { /* ignore */ }
    return NextResponse.json(
      { error: "spotify_top_failed", status, detail: body },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const top = (await topRes.json()) as { items?: any[] };
  const tracks: Track[] = (top.items ?? []).map((t) => ({
    title: t.name,
    artist: (t.artists ?? []).map((a: any) => a.name).join(", "),
    album: t.album?.name ?? "",
    albumArt: t.album?.images?.[0]?.url ?? null,
    url: t.external_urls?.spotify ?? null,
  }));

  return NextResponse.json<Out>(
    { configured: true, range, tracks },
    { headers: { "Cache-Control": "no-store" } },
  );
}
