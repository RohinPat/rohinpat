// One-time auth helper for the Spotify integration on /play.
// Hit this once in your browser at http://127.0.0.1:3000/api/spotify/setup
// (after filling in SPOTIFY_CLIENT_ID/SECRET in .env.local).
// You'll be sent to Spotify, then redirected back here with a refresh token
// to paste into .env.local. After that, this route is no longer needed.

import { NextRequest, NextResponse } from "next/server";

const SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-read-recently-played",
  "user-top-read",
].join(" ");

function getRedirectUri(req: NextRequest) {
  const url = new URL(req.url);
  return `${url.origin}/api/spotify/setup`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return htmlResponse(
      `<h1>Spotify not configured</h1>
       <p>Set <code>SPOTIFY_CLIENT_ID</code> and <code>SPOTIFY_CLIENT_SECRET</code>
       in <code>.env.local</code> first. See <code>.env.local.example</code>
       for the full setup steps.</p>`,
    );
  }

  if (error) {
    return htmlResponse(
      `<h1>Auth error</h1><p>Spotify returned: <code>${escapeHtml(error)}</code></p>`,
    );
  }

  // No code yet → redirect user to Spotify
  if (!code) {
    const redirectUri = getRedirectUri(req);
    const authUrl = new URL("https://accounts.spotify.com/authorize");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("show_dialog", "true");
    return NextResponse.redirect(authUrl.toString());
  }

  // Have code → exchange for refresh token
  const redirectUri = getRedirectUri(req);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
    },
    body,
    cache: "no-store",
  });

  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    return htmlResponse(
      `<h1>Token exchange failed</h1><pre>${escapeHtml(txt)}</pre>
       <p>Common cause: the redirect URI in your Spotify app settings doesn't match
       <code>${escapeHtml(redirectUri)}</code> exactly.</p>`,
    );
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  return htmlResponse(
    `<h1 style="color:#a50044">Done.</h1>
     <p>Copy this refresh token into <code>.env.local</code> as
       <code>SPOTIFY_REFRESH_TOKEN</code>, then restart the dev server.</p>
     <pre style="background:#141414;color:#ededed;padding:1rem;word-break:break-all;white-space:pre-wrap">${escapeHtml(
       tokens.refresh_token,
     )}</pre>
     <p style="margin-top:2rem;font-size:0.85rem;color:#9ca3af">
       Scopes granted: <code>${escapeHtml(tokens.scope)}</code><br/>
       Access token expires in: ${tokens.expires_in}s (refresh handles this automatically).
     </p>
     <p style="margin-top:2rem;font-size:0.85rem;color:#6b7280">
       You won't need this route again. Consider deleting <code>app/api/spotify/setup/route.ts</code> after deploying.
     </p>`,
  );
}

function htmlResponse(html: string) {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Spotify setup</title>
<style>
  body { background:#0a0a0a; color:#ededed; font-family:ui-sans-serif,system-ui; max-width:680px; margin:4rem auto; padding:0 1.5rem; line-height:1.5; }
  code { background:#141414; padding:.15rem .4rem; }
  h1 { font-weight:600; letter-spacing:-0.02em; margin:0 0 1rem; }
  pre { font-family:ui-monospace,monospace; }
</style>
</head>
<body>${html}</body>
</html>`,
    {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
