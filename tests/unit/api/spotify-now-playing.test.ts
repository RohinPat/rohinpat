import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { GET } from "@/app/api/spotify/now-playing/route";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  vi.unstubAllEnvs();
});

function stubCreds() {
  vi.stubEnv("SPOTIFY_CLIENT_ID", "id");
  vi.stubEnv("SPOTIFY_CLIENT_SECRET", "secret");
  vi.stubEnv("SPOTIFY_REFRESH_TOKEN", "refresh");
}

describe("GET /api/spotify/now-playing", () => {
  it("returns { configured: false } when env vars are missing", async () => {
    vi.stubEnv("SPOTIFY_CLIENT_ID", "");
    vi.stubEnv("SPOTIFY_CLIENT_SECRET", "");
    vi.stubEnv("SPOTIFY_REFRESH_TOKEN", "");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: false });
  });

  it("returns simplified track shape on 200 currently-playing", async () => {
    stubCreds();
    server.use(
      http.post("https://accounts.spotify.com/api/token", () =>
        HttpResponse.json({ access_token: "access" }),
      ),
      http.get("https://api.spotify.com/v1/me/player/currently-playing", () =>
        HttpResponse.json({
          is_playing: true,
          progress_ms: 12345,
          item: {
            name: "CAN'T SAY",
            artists: [{ name: "Travis Scott" }],
            album: {
              name: "UTOPIA",
              images: [{ url: "https://i.scdn.co/image/x" }],
            },
            external_urls: { spotify: "https://open.spotify.com/track/x" },
            duration_ms: 200_000,
          },
        }),
      ),
    );

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      configured: true,
      isPlaying: true,
      title: "CAN'T SAY",
      artist: "Travis Scott",
      album: "UTOPIA",
      albumArt: "https://i.scdn.co/image/x",
      url: "https://open.spotify.com/track/x",
      progressMs: 12345,
      durationMs: 200_000,
    });
  });

  it("falls back to recently-played when currently-playing is 204", async () => {
    stubCreds();
    server.use(
      http.post("https://accounts.spotify.com/api/token", () =>
        HttpResponse.json({ access_token: "access" }),
      ),
      http.get("https://api.spotify.com/v1/me/player/currently-playing", () =>
        new HttpResponse(null, { status: 204 }),
      ),
      http.get(
        "https://api.spotify.com/v1/me/player/recently-played",
        () =>
          HttpResponse.json({
            items: [
              {
                played_at: "2026-05-12T12:00:00Z",
                track: {
                  name: "way back",
                  artists: [{ name: "Travis Scott" }],
                  album: {
                    name: "Days Before Rodeo",
                    images: [{ url: "https://i.scdn.co/image/y" }],
                  },
                  external_urls: { spotify: "https://open.spotify.com/track/y" },
                  duration_ms: 180_000,
                },
              },
            ],
          }),
      ),
    );

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      configured: true,
      isPlaying: false,
      title: "way back",
      artist: "Travis Scott",
      playedAt: "2026-05-12T12:00:00Z",
    });
  });

  it("returns 502 when refresh token exchange fails", async () => {
    stubCreds();
    server.use(
      http.post("https://accounts.spotify.com/api/token", () =>
        new HttpResponse("bad", { status: 400 }),
      ),
    );
    const res = await GET();
    expect(res.status).toBe(502);
  });

  it("returns 404 when no history is available", async () => {
    stubCreds();
    server.use(
      http.post("https://accounts.spotify.com/api/token", () =>
        HttpResponse.json({ access_token: "access" }),
      ),
      http.get("https://api.spotify.com/v1/me/player/currently-playing", () =>
        new HttpResponse(null, { status: 204 }),
      ),
      http.get("https://api.spotify.com/v1/me/player/recently-played", () =>
        HttpResponse.json({ items: [] }),
      ),
    );
    const res = await GET();
    expect(res.status).toBe(404);
  });
});
