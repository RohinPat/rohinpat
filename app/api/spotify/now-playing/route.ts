// Returns what the site owner is listening to on Spotify right now,
// or the last track they played if nothing's currently playing.
//
// Requires these env vars (see .env.local.example):
//   SPOTIFY_CLIENT_ID
//   SPOTIFY_CLIENT_SECRET
//   SPOTIFY_REFRESH_TOKEN

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Out =
  | { configured: false }
  | {
      configured: true;
      isPlaying: boolean;
      title: string;
      artist: string;
      album: string;
      albumArt: string | null;
      url: string | null;
      progressMs?: number;
      durationMs?: number;
      playedAt?: string;
    };

export async function GET() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return NextResponse.json<Out>(
      { configured: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

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

  // 2) Try currently playing
  const nowRes = await fetch(
    "https://api.spotify.com/v1/me/player/currently-playing",
    {
      headers: { Authorization: `Bearer ${access_token}` },
      cache: "no-store",
    },
  );

  if (nowRes.status === 200) {
    const data = await nowRes.json();
    if (data?.item) {
      return NextResponse.json<Out>(
        {
          configured: true,
          isPlaying: !!data.is_playing,
          title: data.item.name,
          artist: data.item.artists.map((a: any) => a.name).join(", "),
          album: data.item.album?.name ?? "",
          albumArt: data.item.album?.images?.[0]?.url ?? null,
          url: data.item.external_urls?.spotify ?? null,
          progressMs: data.progress_ms,
          durationMs: data.item.duration_ms,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  // 3) Fall back to last played
  const recentRes = await fetch(
    "https://api.spotify.com/v1/me/player/recently-played?limit=1",
    {
      headers: { Authorization: `Bearer ${access_token}` },
      cache: "no-store",
    },
  );

  if (!recentRes.ok) {
    return NextResponse.json(
      { error: "spotify_recent_failed", status: recentRes.status },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  const recent = await recentRes.json();
  const item = recent?.items?.[0];
  if (!item) {
    return NextResponse.json(
      { error: "no_history" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json<Out>(
    {
      configured: true,
      isPlaying: false,
      title: item.track.name,
      artist: item.track.artists.map((a: any) => a.name).join(", "),
      album: item.track.album?.name ?? "",
      albumArt: item.track.album?.images?.[0]?.url ?? null,
      url: item.track.external_urls?.spotify ?? null,
      playedAt: item.played_at,
      durationMs: item.track.duration_ms,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
